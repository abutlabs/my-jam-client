// Observability: the client tells the observability stack what it does. Events go to
// Loki, numbers to the Pushgateway, and Grafana shows both.

const LOKI = "http://127.0.0.1:3100";
const PUSHGATEWAY = "http://127.0.0.1:9091";
const GRAFANA = "http://127.0.0.1:3300";

/** Who is reporting: "you", unless OBS_CLIENT says otherwise. */
const CLIENT = process.env.OBS_CLIENT ?? "you";

/** One run of the client (its tests, or a program): what it did and what it measured. */
export class Run {
  readonly kind: string;
  readonly id: string;
  #events: [string, string][] = []; // [time in nanoseconds, line], as Loki wants them
  #numbers: string[] = []; // lines of Prometheus text, as the Pushgateway wants them

  constructor(kind: string) {
    this.kind = kind;
    this.id = `${kind}-${Date.now()}`;
  }

  /** Something the client did: the step, and the values worth seeing. */
  event(step: string, fields: Record<string, unknown> = {}): void {
    // nanoseconds; adding the event's number keeps events in the order they happened
    const time = BigInt(Date.now()) * 1_000_000n + BigInt(this.#events.length);
    this.#events.push([time.toString(), line(step, fields)]);
  }

  /** A number the run measured, such as how many tests passed. */
  number(name: string, value: number): void {
    this.#numbers.push(`gray_tutorial_${name}{run_id="${this.id}"} ${value}\n`);
  }

  /** Sends the run to the stack: where to see it in Grafana, or null if the stack is down. */
  async report(): Promise<string | null> {
    const labels = { job: "gray_tutorial", client: CLIENT, kind: this.kind, run_id: this.id };
    try {
      const loki = await fetch(`${LOKI}/loki/api/v1/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streams: [{ stream: labels, values: this.#events }] }),
      });
      const group = `${PUSHGATEWAY}/metrics/job/gray_tutorial/client/${CLIENT}/kind/${this.kind}`;
      const push = await fetch(group, { method: "PUT", body: this.#numbers.join("") });
      if (!loki.ok || !push.ok) throw new Error("the stack said no");
    } catch {
      console.log("not reported: is the observability stack up? (../observability/obs up)");
      return null;
    }
    return `${GRAFANA}/d/gray-tutorial?var-client=${CLIENT}&var-run_id=${this.id}`;
  }
}

/** An event as Loki stores it: one line of JSON. */
function line(step: string, fields: Record<string, unknown>): string {
  return JSON.stringify({ step, ...fields });
}