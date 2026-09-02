// CoEditor 开源版桌面壳：内置本地 server sidecar。
// - dev：窗口直连 Taro dev server（localhost:5173），后端走 devServer 代理
// - prod：随机端口拉起 coeditor-server sidecar（内置静态 dist-h5 + /api 同源）
//
// 职责边界：数据目录的一切逻辑（平台默认、指针文件、运行时切换、种子化）都在
// 服务端（packages/server）。桌面壳**不设置 COEDITOR_DATA_DIR**，sidecar 像裸启动
// 一样自行解析；种子数据（模板/提示词）由服务端内置（seed.ts），无需外部传入。
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct SidecarState(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // dev 构建：不拉 sidecar，直接用 Taro dev server（由 beforeDevCommand 启动）
            #[cfg(dev)]
            {
                create_main_window(app, "http://localhost:5173")?;
                return Ok(());
            }

            #[cfg(not(dev))]
            {
                let port = pick_free_port();
                let web_root = web_root_path(app)?;

                let (mut rx, child) = app
                    .shell()
                    .sidecar("coeditor-server")
                    .expect("sidecar coeditor-server 未找到：请先运行 desktop/build-desktop.sh")
                    .env("PORT", port.to_string())
                    .env("HOST", "127.0.0.1")
                    .env("COEDITOR_WEB_ROOT", web_root.to_string_lossy().to_string())
                    .spawn()
                    .expect("启动 coeditor server sidecar 失败");

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

                wait_ready(port);
                create_main_window(app, &format!("http://127.0.0.1:{port}/"))?;
                return Ok(());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(s) = app_handle.try_state::<SidecarState>() {
                    if let Some(child) = s.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

fn create_main_window(app: &tauri::App, url: &str) -> tauri::Result<()> {
    let _ = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::External(url.parse().expect("invalid window url")),
    )
    .title("校书郎（单机版）")
    .inner_size(1280.0, 820.0)
    .min_inner_size(960.0, 620.0)
    .build()?;
    Ok(())
}

/// 挑一个空闲的 loopback 端口（绑定 :0 后释放，竞态窗口极小）。
fn pick_free_port() -> u16 {
    let l = TcpListener::bind("127.0.0.1:0").expect("bind 127.0.0.1:0 失败");
    let port = l.local_addr().expect("local_addr 失败").port();
    drop(l);
    port
}

/// 等待 sidecar 就绪：GET / 返回 200（静态服务补丁后 / 即 index.html）。
fn wait_ready(port: u16) {
    for _ in 0..150 {
        if probe(port) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("coeditor server 未在 15s 内就绪（port {port}）");
}

fn probe(port: u16) -> bool {
    if let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) {
        let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
        let req = format!(
            "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        );
        if s.write_all(req.as_bytes()).is_ok() {
            let mut buf = [0u8; 64];
            if s.read(&mut buf).is_ok() {
                return buf.starts_with(b"HTTP/1.1 200");
            }
        }
    }
    false
}

/// Web 静态根：捆绑进资源的 dist-h5。
fn web_root_path(app: &tauri::App) -> tauri::Result<PathBuf> {
    app.path()
        .resolve("dist-h5", tauri::path::BaseDirectory::Resource)
}
