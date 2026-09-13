// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 启动失败的可见性保证：
// 上面这行让发布版在 Windows 成为 GUI 子系统程序——**没有控制台**，
// 于是 eprintln!/panic! 的输出用户完全看不到，启动失败就表现为
// 「双击没反应、进程消失」。典型场景：系统缺少 WebView2 运行时。
//
// 因此启动期错误不再用 .expect() 让它静默 panic，而是统一走
// lib.rs 的 report_fatal_error（弹原生对话框 + 写崩溃日志）。
// 见 lib.rs 顶部说明：Tauri 会在事件循环里对 setup 错误 panic（ObjC 栈帧下无法 unwind），
// 所以错误必须在 setup 内部消化掉，不能靠外层的 Result 或 panic hook。
fn main() {
    coeditor_desktop_lib::run()
}
