// A soft two-note chime, synthesised on the device.
//
// NO AUDIO FILE, and that is a functional choice rather than a clever
// one: this plays in a back corridor on clinic wifi, and a 40KB mp3 that
// has not finished downloading is a reminder that did not happen. An
// oscillator starts instantly and works offline.
//
// ON THE FREQUENCIES. 528 rising to 660 Hz sounds like a hospital
// nurse-call chime, which is the whole reason for it: staff already read
// that timbre as "attend to something" rather than as an alarm. It is
// worth saying plainly that 528 Hz has no therapeutic property — the
// "healing frequency" claim attached to it is not real. It is here
// because it sounds right in a clinic, sits above ambient HVAC noise,
// and is low enough not to be piercing.
//
// AND IT IS QUIET ON PURPOSE. Peak gain 0.18 with a 40ms attack and a
// long exponential decay. A compliance reminder that startles somebody
// holding a specimen cup is a reminder that gets switched off within a
// day, and a switched-off reminder protects nobody.

const PEAK = 0.18;
const ATTACK = 0.04;
const DECAY = 0.9;

type Ctx = AudioContext & { state: AudioContextState };

class Chime {
  private ctx: Ctx | null = null;
  private unlocked = false;

  /**
   * Create the AudioContext inside a real user gesture.
   *
   * Every browser starts an AudioContext suspended and only a genuine
   * gesture may resume it. A context created on page load and resumed
   * later from a timer stays silent — no error, no warning, just nothing
   * — which is the single most common way a web notification chime ships
   * broken. So this is called from a click, once, and the result is
   * remembered.
   */
  unlock(): void {
    if (this.unlocked) return;
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!Ctor) return;

    try {
      this.ctx = new Ctor() as Ctx;
      void this.ctx.resume();
      this.unlocked = true;
    } catch {
      // Audio is unavailable — an old browser, or a policy that blocks
      // it. The visual reminder still works, so this stays silent
      // rather than throwing inside a click handler.
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  play(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // A tab left open overnight comes back suspended on some browsers.
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(528, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.15);

    // exponentialRampToValueAtTime cannot reach or start from zero, so
    // the envelope runs between small non-zero values. Ramping to 0
    // throws and takes the whole reminder with it.
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(PEAK, now + ATTACK);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + DECAY);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + DECAY);

    // Oscillators are single-use. Without this, a shift's worth of
    // reminders leaves a node per chime attached to the destination.
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}

export const chime = new Chime();
