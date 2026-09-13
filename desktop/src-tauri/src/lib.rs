// CoEditor 开源版桌面壳：内置本地 server sidecar。
// - dev：窗口直连 Taro dev server（localhost:5173），后端走 devServer 代理
// - prod：随机端口拉起 coeditor-server sidecar（内置静态 dist-h5 + /api 同源）
//
// 职责边界：数据目录的一切逻辑（平台默认、指针文件、运行时切换、种子化）都在
// 服务端（packages/server）。桌面壳**不设置 COEDITOR_DATA_DIR**，sidecar 像裸启动
// 一样自行解析；种子数据（模板/提示词）由服务端内置（seed.ts），无需外部传入。
use std::fmt;
use std::io::Write;
use std::path::PathBuf;

// TcpListener / TcpStream / Duration / Read 只在 sidecar 就绪探测里用（非 dev 构建）。
#[cfg(not(dev))]
use std::io::Read;
#[cfg(not(dev))]
use std::net::{TcpListener, TcpStream};
#[cfg(not(dev))]
use std::time::Duration;

use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::Manager;

// sidecar 相关的 trait/类型只在非 dev 构建里用到（dev 直连 dev server，不拉 sidecar），
// 不 gate 掉的话 dev 构建会报 unused import / 找不到符号。
#[cfg(not(dev))]
use std::sync::Mutex;
#[cfg(not(dev))]
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
#[cfg(not(dev))]
use tauri_plugin_shell::ShellExt;

#[cfg(not(dev))]
struct SidecarState(Mutex<Option<CommandChild>>);

/// 启动期致命错误的载体：只需可读的 Display，供 tauri::Error::Setup 上报给 main.rs。
/// （tauri::Error::Setup 收的是 anyhow::Error；anyhow 不在本项目依赖里，故自带一个 Error 实现。）
#[derive(Debug)]
struct FatalError(String);

impl fmt::Display for FatalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for FatalError {}

// ==== 启动期致命错误上报 ====
//
// 背景：Windows 发布版是 GUI 子系统（见 main.rs 的 windows_subsystem="windows"），**没有控制台**。
// 因此 eprintln!、panic!（以及 .expect()）的输出用户完全看不到——启动失败的表现就是
// 「双击没反应、进程消失」，最难排查。典型场景：系统缺少 WebView2 运行时。
//
// 对策：启动期失败一律**向上返回**（不再 panic），由 main.rs 调 report_fatal_error：
// 弹原生对话框 + 写崩溃日志，保证「错误一定看得见」。

/// 启动流程中任何失败都转成 tauri::Error，交给 main.rs 统一上报。
/// 注意 `tauri::Error::Setup` 收的是 anyhow::Error（SetupError），所以用自带 Error 实现包一层。
fn fatal(msg: impl Into<String>) -> tauri::Error {
    // 显式转成 trait object：SetupError 内部是 Box<dyn std::error::Error>，
    // 直接传 Box<FatalError> 不会被自动强转（newtype 无隐式 unsize）。
    let boxed: Box<dyn std::error::Error> = Box::new(FatalError(msg.into()));
    tauri::Error::Setup(boxed.into())
}

/// 崩溃日志候选路径，按优先级排序。
/// 逐一尝试的原因：macOS 上 `std::env::temp_dir()` 可能落在 `TMPDIR`（每个应用专属的
/// 沙箱目录 `.../T/`），写文件会被拒；此时需要回退到更稳的位置，否则「写日志」形同虚设。
fn crash_log_candidates() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(dir) = std::env::var("LOCALAPPDATA") {
            if !dir.is_empty() {
                v.push(PathBuf::from(dir).join("coeditor").join("crash.log"));
            }
        }
    }
    #[cfg(not(windows))]
    {
        // macOS/Linux：~/Library/Logs 或 ~/.local/state 更稳，其次是系统临时目录。
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                #[cfg(target_os = "macos")]
                v.push(PathBuf::from(&home).join("Library/Logs/coeditor-crash.log"));
                v.push(PathBuf::from(&home).join(".coeditor-crash.log"));
            }
        }
    }
    // 最后兜底：系统临时目录（Windows 上即 %TEMP%）与当前工作目录
    v.push(std::env::temp_dir().join("coeditor-crash.log"));
    v.push(PathBuf::from("coeditor-crash.log"));
    v
}

/// 把致命错误写进日志文件（对话框可能被用户秒关，日志留痕便于事后排查）。
/// 返回实际写入成功的路径（全部失败则为 None）。
fn append_crash_log(text: &str) -> Option<PathBuf> {
    for path in crash_log_candidates() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            Ok(mut f) => match writeln!(f, "{text}") {
                Ok(()) => return Some(path),
                Err(e) => eprintln!("[coeditor] 写日志失败 {}: {e}", path.display()),
            },
            Err(e) => eprintln!("[coeditor] 无法打开日志 {}: {e}", path.display()),
        }
    }
    eprintln!("[coeditor] 所有候选路径均不可写，日志仅输出到 stderr");
    eprintln!("{text}");
    None
}

/// Windows 原生错误对话框：GUI 子系统下这是唯一能保证用户看见的通道。
#[cfg(windows)]
fn native_error_dialog(title: &str, message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let (t, m) = (wide(title), wide(message));
    // SAFETY: 首个参数为 null 表示无父窗口；两个字符串都是 NUL 结尾的宽字符缓冲，生命周期覆盖本次调用。
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            m.as_ptr(),
            t.as_ptr(),
            MB_OK | MB_ICONERROR | MB_SETFOREGROUND,
        );
    }
}

#[cfg(not(windows))]
fn native_error_dialog(_title: &str, _message: &str) {
    // macOS/Linux 有终端，append_crash_log 里的 eprintln 已足够。
}

/// 判断是否属于「WebView2 运行时缺失」类错误（Windows 特有）。
fn looks_like_webview2_missing(detail: &str) -> bool {
    let d = detail.to_ascii_lowercase();
    d.contains("webview2") || d.contains("0x80070002")
}

/// 启动失败统一出口：对话框 + 日志，返回后由 main.rs 以非零码退出。
/// `detail` 为 None 时展示通用文案（GUI 下 panic 消息不会被打印出来）。
pub fn report_fatal_error(detail: Option<&str>) {
    let detail = detail.unwrap_or("(无错误详情：程序在初始化阶段退出，且未返回错误信息)");
    let webview2 = looks_like_webview2_missing(detail);
    let title = "校书郎 启动失败";

    let message = if webview2 {
        format!(
            "缺少 Microsoft Edge WebView2 运行时，程序无法启动。\n\n\
             解决方法（任选其一）：\n\
             1. 访问 https://go.microsoft.com/fwlink/p/?LinkId=2124703 下载并安装\n\
             2. 或重新运行安装包，让安装程序自动安装\n\n\
             安装完成后重新启动本程序。\n\n\
             —— 技术详情 ——\n{detail}"
        )
    } else {
        format!(
            "程序启动时发生错误，未能打开窗口。\n\n\
             请把下面的技术详情反馈给我们：\n\n{detail}"
        )
    };

    let body = format!(
        "\n===== {} =====\n[{}] {}\n",
        title,
        if webview2 {
            "WebView2 缺失"
        } else {
            "启动失败"
        },
        detail
    );
    let logged_at = append_crash_log(&body);
    let message = match &logged_at {
        Some(p) => format!("{message}\n\n（日志已写入：{}）", p.display()),
        None => message,
    };
    native_error_dialog(title, &message);
}

/// 菜单语言是否跟随系统（zh 系统 → 中文菜单；否则英文）。
/// 系统语言判断用 sys-locale，回退到 LANG 环境变量。
fn system_is_zh() -> bool {
    let detect =
        || -> Option<String> { sys_locale::get_locale().or_else(|| std::env::var("LANG").ok()) };
    detect()
        .map(|l| l.to_ascii_lowercase().starts_with("zh"))
        .unwrap_or(false)
}

/// 菜单文案按系统语言生成（macOS 下“关于/退出/撤销…”等预置项以 None 交给系统本地化，
/// 这里只按系统语言定我们的自定义文案：设置…/回到首页/编辑/视图）
fn build_menu<R: tauri::Runtime>(
    manager: &impl tauri::Manager<R>,
    zh: bool,
) -> tauri::Result<tauri::menu::Menu<R>> {
    let (app_name, settings_label, home_label, edit_label, view_label) = if zh {
        ("校书郎", "设置…", "回到首页", "编辑", "视图")
    } else {
        ("CoEditor", "Settings…", "Back to Home", "Edit", "View")
    };

    let about = PredefinedMenuItem::about(manager, None, None)?;
    let sep1 = PredefinedMenuItem::separator(manager)?;
    let quit = PredefinedMenuItem::quit(manager, None)?;
    let settings_item = MenuItem::with_id(
        manager,
        "open-settings",
        settings_label,
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let home_item = MenuItem::with_id(
        manager,
        "go-home",
        home_label,
        true,
        Some("CmdOrCtrl+Shift+H"),
    )?;

    let app_menu = SubmenuBuilder::new(manager, app_name)
        .items(&[&about, &settings_item, &sep1, &quit])
        .build()?;

    let sep2 = PredefinedMenuItem::separator(manager)?;
    let undo = PredefinedMenuItem::undo(manager, None)?;
    let redo = PredefinedMenuItem::redo(manager, None)?;
    let cut = PredefinedMenuItem::cut(manager, None)?;
    let copy = PredefinedMenuItem::copy(manager, None)?;
    let paste = PredefinedMenuItem::paste(manager, None)?;
    let select_all = PredefinedMenuItem::select_all(manager, None)?;
    let edit_menu = SubmenuBuilder::new(manager, edit_label)
        .items(&[&undo, &redo, &sep2, &cut, &copy, &paste, &select_all])
        .build()?;

    let view_menu = SubmenuBuilder::new(manager, view_label)
        .items(&[&home_item])
        .build()?;

    MenuBuilder::new(manager)
        .items(&[&app_menu, &edit_menu, &view_menu])
        .build()
}

/// 启动时按系统语言构建菜单（不随应用内语言切换；预置项由系统本地化）
fn setup_menu(app: &tauri::App) -> tauri::Result<()> {
    let zh = system_is_zh();
    let menu = build_menu(app, zh)?;
    app.set_menu(menu)?;
    Ok(())
}

/// 把菜单事件以 DOM CustomEvent 派发给 WebView（无需额外 IPC 权限/依赖）。
fn dispatch_to_window(app: &tauri::AppHandle, js: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(js);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // 原生菜单项 → 前端 DOM CustomEvent（前端 initDesktopAdapters 里 listen）
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-settings" => {
                dispatch_to_window(
                    app,
                    "window.dispatchEvent(new CustomEvent('coeditor:open-settings'))",
                );
            }
            "go-home" => {
                dispatch_to_window(
                    app,
                    "window.dispatchEvent(new CustomEvent('coeditor:go-home'))",
                );
            }
            _ => {}
        })
        .setup(|app| {
            // 启动期错误必须在这里就地消化，**不能 return Err**：
            // Tauri 在事件循环的 Ready 回调里对 setup 错误直接 panic（app.rs:1425），
            // 而该处处于 ObjC 栈帧中，panic 无法 unwind（变成 abort），会绕过 main.rs 的
            // panic hook —— 结果就是 GUI 下「静默退出」，正是要修的问题。
            // 所以这里失败时：弹对话框上报 + 结束进程，然后返回 Ok 让流程干净收尾。
            if let Err(err) = start_app(app) {
                // Tauri 会把 setup 错误包一层 "error encountered during setup hook"，直接展示
                // 会让用户困惑；这里补一句人话说明，再附技术详情。
                report_fatal_error(Some(&format!("程序启动失败，原因：{err}")));
                app.handle().exit(1);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri application context")
        .run(|_app_handle, event| {
            // 退出时回收 sidecar（逻辑在辅助函数里，便于按 cfg 分流：
            // 该状态只在非 dev 构建存在，dev 不拉 sidecar）。
            cleanup_on_shutdown(_app_handle, &event);
        });
}

/// 启动期主体流程。所有失败都通过返回值上报（由 setup 统一处理，见上）。
fn start_app(app: &tauri::App) -> tauri::Result<()> {
    setup_menu(app)?;

    // dev 构建：不拉 sidecar，直接用 Taro dev server（由 beforeDevCommand 启动）
    #[cfg(dev)]
    {
        create_main_window(app, "http://localhost:5173")?;
        Ok(())
    }

    #[cfg(not(dev))]
    {
        let port = pick_free_port()?;
        let web_root = web_root_path(app)?;

        // 注意：sidecar() 返回的是 builder 而非 Result，「找不到 sidecar」也要显式报错。
        let (mut rx, child) = app
            .shell()
            .sidecar("coeditor-server")
            .map_err(|e| {
                fatal(format!(
                    "未找到内置服务组件 coeditor-server：{e}\n请先执行 desktop/build-desktop.sh 重新打包。"
                ))
            })?
            .env("PORT", port.to_string())
            .env("HOST", "127.0.0.1")
            .env("COEDITOR_WEB_ROOT", web_root.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| fatal(format!("启动内置服务组件失败：{e}")))?;

        app.manage(SidecarState(Mutex::new(Some(child))));

        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Error(e) => eprintln!("[sidecar] {e}"),
                    CommandEvent::Terminated(p) => {
                        eprintln!("[sidecar] terminated: {p:?}")
                    }
                    _ => {}
                }
            }
        });

        wait_ready(port)?;
        create_main_window(app, &format!("http://127.0.0.1:{port}/"))?;
        Ok(())
    }
}

/// 退出时回收 sidecar 子进程，避免残留 coeditor-server 占着端口。
#[cfg(not(dev))]
fn cleanup_on_shutdown(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    if let tauri::RunEvent::Exit = event {
        if let Some(state) = app.try_state::<SidecarState>() {
            if let Ok(mut guard) = state.0.lock() {
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
            }
        }
    }
}

#[cfg(dev)]
fn cleanup_on_shutdown(_app: &tauri::AppHandle, _event: &tauri::RunEvent) {}

fn create_main_window(app: &tauri::App, url: &str) -> tauri::Result<()> {
    let parsed = url
        .parse()
        .map_err(|e| fatal(format!("窗口地址无效（{url}）：{e}")))?;
    let _ = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(parsed))
        .title("校书郎")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 620.0)
        .build()?;
    Ok(())
}

/// 挑一个空闲的 loopback 端口（绑定 :0 后释放，竞态窗口极小）。
/// dev 构建直连 dev server，不需要 sidecar 与端口探测，故整组函数按 not(dev) 门控。
#[cfg(not(dev))]
fn pick_free_port() -> tauri::Result<u16> {
    let l =
        TcpListener::bind("127.0.0.1:0").map_err(|e| fatal(format!("无法绑定本地端口：{e}")))?;
    let port = l
        .local_addr()
        .map_err(|e| fatal(format!("读取本地端口失败：{e}")))?
        .port();
    drop(l);
    Ok(port)
}

#[cfg(not(dev))]
/// 等待 sidecar 就绪：GET / 返回 200（静态服务补丁后 / 即 index.html）。
fn wait_ready(port: u16) -> tauri::Result<()> {
    for _ in 0..150 {
        if probe(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(fatal(format!(
        "内置服务组件未在 15 秒内就绪（端口 {port}）。\n可能被杀毒软件拦截，或组件启动即崩溃。"
    )))
}

#[cfg(not(dev))]
fn probe(port: u16) -> bool {
    if let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) {
        let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
        let req = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
        if s.write_all(req.as_bytes()).is_ok() {
            let mut buf = [0u8; 64];
            if s.read(&mut buf).is_ok() {
                return buf.starts_with(b"HTTP/1.1 200");
            }
        }
    }
    false
}

#[cfg(not(dev))]
/// Web 静态根：捆绑进资源的 dist-h5。
fn web_root_path(app: &tauri::App) -> tauri::Result<PathBuf> {
    app.path()
        .resolve("dist-h5", tauri::path::BaseDirectory::Resource)
}
