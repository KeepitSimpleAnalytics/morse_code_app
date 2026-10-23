// Prevents an extra console window on Windows in release. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    morse_trainer_lib::run()
}
