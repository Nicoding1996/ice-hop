// Minimal Chrome DevTools Protocol driver for the UI smoke test. Uses only
// Node built-ins (child_process, fetch, WebSocket) and a local Chrome/Edge.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Read a property from an untrusted JSON value without casting. */
export const property = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export const findBrowser = (): string | null => {
  for (const candidate of BROWSER_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
};

export class Page {
  private nextId = 0;
  private readonly pending = new Map<number, (message: unknown) => void>();
  readonly problems: string[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => this.receive(event.data));
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    const message: unknown = JSON.parse(data);
    const id = property(message, 'id');
    if (typeof id === 'number') {
      this.pending.get(id)?.(message);
      this.pending.delete(id);
      return;
    }
    const method = property(message, 'method');
    const params = property(message, 'params');
    if (method === 'Runtime.exceptionThrown') {
      const details = property(params, 'exceptionDetails');
      const description = property(property(details, 'exception'), 'description');
      this.problems.push(
        `exception: ${typeof description === 'string' ? description : String(property(details, 'text'))}`
      );
    } else if (method === 'Runtime.consoleAPICalled' && property(params, 'type') === 'error') {
      const args = property(params, 'args');
      const text = Array.isArray(args)
        ? args.map((arg) => String(property(arg, 'value') ?? property(arg, 'description') ?? '')).join(' ')
        : '';
      this.problems.push(`console.error: ${text}`);
    }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), 30_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        const error = property(message, 'error');
        if (error) reject(new Error(`CDP ${method}: ${String(property(error, 'message'))}`));
        else resolve(property(message, 'result'));
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const exception = property(result, 'exceptionDetails');
    if (exception) throw new Error(`evaluate failed: ${String(property(exception, 'text'))}`);
    return property(property(result, 'result'), 'value');
  }

  async setViewport(width: number, height: number, deviceScaleFactor: number): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: true,
    });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  async navigate(url: string, settleMs: number): Promise<void> {
    await this.send('Page.navigate', { url });
    await sleep(settleMs);
  }

  async tap(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(50);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async swipe(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
    const steps = 8;
    for (let step = 1; step <= steps; step++) {
      await sleep(16);
      await this.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x1 + ((x2 - x1) * step) / steps, y: y1 + ((y2 - y1) * step) / steps }],
      });
    }
    await sleep(30);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** Centre of the first element matching `selector`, or null. */
  async centerOf(selector: string): Promise<{ x: number; y: number } | null> {
    const value = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`
    );
    const x = property(value, 'x');
    const y = property(value, 'y');
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
  }

  async screenshot(path: string): Promise<void> {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const data = property(result, 'data');
    if (typeof data === 'string') writeFileSync(path, Buffer.from(data, 'base64'));
  }
}

export type Browser = {
  readonly page: Page;
  close(): Promise<void>;
};

export const launchBrowser = async (executable: string): Promise<Browser> => {
  const profile = mkdtempSync(join(tmpdir(), 'icehop-ui-smoke-'));
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  // Chrome writes the chosen port to DevToolsActivePort in its profile.
  const portFile = join(profile, 'DevToolsActivePort');
  let port = 0;
  for (let attempt = 0; attempt < 150 && port === 0; attempt++) {
    if (existsSync(portFile)) {
      const parsed = Number.parseInt(readFileSync(portFile, 'utf8').split('\n')[0] ?? '', 10);
      if (Number.isSafeInteger(parsed) && parsed > 0) port = parsed;
    }
    if (port === 0) await sleep(100);
  }
  if (port === 0) {
    child.kill();
    throw new Error('The browser did not expose a DevTools port.');
  }

  const target: unknown = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const url = property(target, 'webSocketDebuggerUrl');
  if (typeof url !== 'string') throw new Error('No DevTools page target was created.');
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('DevTools socket failed.')), {
      once: true,
    });
  });
  const page = new Page(socket);
  await page.send('Runtime.enable');
  await page.send('Page.enable');

  return {
    page,
    close: async () => {
      socket.close();
      child.kill();
      await sleep(400);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // A browser process that is still exiting may hold the profile briefly.
      }
    },
  };
};
