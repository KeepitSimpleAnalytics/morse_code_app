# Audio latency measurements

SPEC §6 and §13: output latency above 40 ms on a target OS is raised as an issue. Keyer jitter is measured in phase 8 and recorded here too.

## How it's measured

The Text Player status bar has a **Check audio latency** button. It reports `ctx.baseLatency + ctx.outputLatency` from the app's single `AudioContext` (`latencyHint: "interactive"`), as WebView2 sees it for the current default output device.

These are the browser's own estimates. They don't include extra device buffering it can't see, such as Bluetooth codecs or monitor audio processing. A loopback measurement, with a microphone recording the key-down click, is the planned cross-check for phase 8 if sidetone feels late.

## Results

| Date       | OS                                      | Machine / output                                                                                                                                                                                                            | Reported total | Verdict                                           |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------- |
| 2026-10-23 | Windows 11 Pro 10.0.26200, WebView2 155 | Development and target machine. Default output not identified at measurement time; active endpoints were Realtek onboard (digital out), LC32G7xT monitor over NVIDIA HDMI, FIFINE 683 USB headset, and Logitech Z407 (USB). | **50 ms**      | **Over the 40 ms threshold. Raised as an issue.** |

### Open issue: 50 ms on the target machine

- **Impact on listening modes:** none. Lessons, the Text Player and ICR schedule everything ahead of time, and highlighting is shifted by `outputLatency` so it matches what you hear.
- **Impact on sending practice (phase 8):** sidetone would lag the key by about 50 ms, which most operators notice at 20 WPM and above.
- **Next step:** re-measure with wired headphones on the Realtek analog output. HDMI monitor audio and USB speakers often add 30–60 ms. If no output on this machine gets under 40 ms, phase 8 must build the Rust `cpal` sidetone fallback (SPEC §13) instead of only planning it.
