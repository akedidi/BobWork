fn main() {
    #[cfg(target_os = "macos")]
    {
        compile_modern_speech_bridge();
        cc::Build::new()
            .file("native/system_audio_recorder.m")
            .file("native/local_audio_transcriber.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("bob_work_system_audio_recorder");
        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=AudioToolbox");
        println!("cargo:rustc-link-lib=framework=Speech");
        println!("cargo:rustc-link-lib=framework=NaturalLanguage");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rerun-if-changed=native/system_audio_recorder.m");
        println!("cargo:rerun-if-changed=native/local_audio_transcriber.m");
        println!("cargo:rerun-if-changed=native/local_audio_transcriber_modern.swift");
    }
    tauri_build::build();
}

#[cfg(target_os = "macos")]
fn compile_modern_speech_bridge() {
    use std::path::PathBuf;
    use std::process::Command;

    let output_dir = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR is missing"));
    let object_path = output_dir.join("local_audio_transcriber_modern.o");
    let architecture = std::env::var("CARGO_CFG_TARGET_ARCH").expect("target architecture missing");
    let target = format!("{architecture}-apple-macosx12.0");
    let sdk_output = Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-path"])
        .output()
        .expect("failed to locate the macOS SDK");
    assert!(
        sdk_output.status.success(),
        "failed to locate the macOS SDK"
    );
    let sdk_path = String::from_utf8(sdk_output.stdout)
        .expect("macOS SDK path is not UTF-8")
        .trim()
        .to_owned();
    let swiftc_output = Command::new("xcrun")
        .args(["--find", "swiftc"])
        .output()
        .expect("failed to locate swiftc");
    assert!(swiftc_output.status.success(), "failed to locate swiftc");
    let swiftc_path = PathBuf::from(
        String::from_utf8(swiftc_output.stdout)
            .expect("swiftc path is not UTF-8")
            .trim(),
    );
    let swift_library_path = swiftc_path
        .parent()
        .and_then(|path| path.parent())
        .expect("swiftc installation layout is invalid")
        .join("lib/swift/macosx");

    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-parse-as-library",
            "-emit-object",
            "-module-name",
            "BobWorkSpeech",
            "-target",
            &target,
            "-sdk",
            &sdk_path,
            "-o",
        ])
        .arg(&object_path)
        .arg("native/local_audio_transcriber_modern.swift")
        .status()
        .expect("failed to compile the native Apple Speech bridge");
    assert!(
        status.success(),
        "failed to compile the native Apple Speech bridge"
    );

    cc::Build::new()
        .object(&object_path)
        .compile("bob_work_modern_speech_bridge");
    println!(
        "cargo:rustc-link-search=native={}",
        swift_library_path.display()
    );
    // Swift's driver adds this automatically; rustc's clang linker does not.
    // It resolves the system Swift concurrency runtime on supported macOS versions.
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
