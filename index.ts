import { MessageType, type ClientMessage, type Subscriptions } from "./shared";

enum PromiseStatus {
  Fulfilled,
  Pending,
  Rejected,
}

const globalContext = {
  resources: {} as Record<string, number>,
  resolves: {} as Record<number, (value: any) => void>,
  promises: [] as PromiseState<any>[],
  websockets: {} as Record<string, AsyncWebSocket>,
}

type Executor<T> = (state: PromiseState<T>) => Promise<T>;

const NOT_INITIALIZED = Symbol("Data not initialized");

class PromiseState<T> {
  data: T | typeof NOT_INITIALIZED = NOT_INITIALIZED;
  initialized = false;
  consumed = false;
  status: PromiseStatus = PromiseStatus.Pending;
  promise: Promise<T>;
  stored: Promise<T>;
  executor: Executor<T>
  id: number;
  constructor(id: number, executor: Executor<T>) {
    this.id = id;
    this.executor = executor;
    this.promise = this.createPromise();
    this.stored ??= this.promise;
  }

  async createPromise() {
    this.status = PromiseStatus.Pending;
    try {
      this.data = await this.executor(this);
      this.initialized = true;
      this.status = PromiseStatus.Fulfilled;
      return this.data
    } catch (e) {
      console.log(e)
      this.status = PromiseStatus.Rejected;
      throw e;
    } finally {
    }
  }

  createResolver() {
    return new Promise<T>((resolve) => {
      globalContext.resolves[this.id] = resolve;
    })
  }

  resolve(value: T) {
    globalContext.resolves[this.id](value);
  }

  cached() {
    return Promise.resolve(this.data);
  }
}


class AsyncWebSocket {
  ws: WebSocket;
  openPromise: Promise<void>;
  promises: Record<string, number> = {};
  constructor(ws: WebSocket) {
    this.ws = ws;
    let _resolve: () => void;
    let _reject;
    this.openPromise = new Promise((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });
    this.ws.addEventListener("open", () => {
      _resolve()
    });
    this.ws.addEventListener("message", (ev) => {
      const data = JSON.parse(ev.data);
      console.log(data);
      const id = this.promises[data.path];
      if (id !== undefined) {
        const state = globalContext.promises[id];
        if (state.status === PromiseStatus.Fulfilled) {
          state.stored = state.createPromise();
        }
        state.promise = state.stored;
        globalContext.resolves[state.id](data.data);
      }
    })
  }

  send(payload: any) {
    this.ws.send(payload);
  }

}

class WebSocketContext {
  ws: AsyncWebSocket;
  context: Context;
  constructor(ws: AsyncWebSocket, context: Context) {
    this.ws = ws;
    this.context = context;
  }
  async subscribe<K extends keyof Subscriptions>(path: K): Promise<Subscriptions[K]> {
    const id = this.ws.promises[path];
    if (id !== undefined) {
      const state = globalContext.promises[id];
      if (!this.context.promises.includes(id)) {
        if (state.status === PromiseStatus.Pending && state.initialized) {
          state.stored = state.promise;
          state.promise = state.cached();
        }
        this.context.promises.push(id);
      }
      state.consumed = true;
      return state.promise;
    }
    const promise = this.context.createPromiseState<Subscriptions[K]>(async (state) => {
      return state.createResolver();
    })
    this.ws.promises[path] = promise.id;
    promise.consumed = true;
    await this.ws.openPromise;
    this.ws.send(JSON.stringify({ type: MessageType.Subscribe, path } satisfies ClientMessage));
    return promise.promise;
  }
  send(payload: any) {
    this.ws.send(JSON.stringify(payload));
  }
}

export type CreateElement = <T extends keyof HTMLElementTagNameMap>(tag: T, attrs?: any, ...children: any[]) => HTMLElementTagNameMap[T];
export class Context {
  promises: number[] = [];
  private properties: Record<string, number> = {};
  private states: Record<string, number> = {};
  private initialVals: Record<string, any> = {};
  addListener(element: HTMLElement, event: string, listener: (ctx: Context, e: Event) => Promise<void>) {
    element.addEventListener(event, async (e) => {
      this.promises.forEach((id) => {
        const state = globalContext.promises[id];
        state.stored = state.promise;
        state.promise = state.cached();
      });
      await listener(this, e);
      this.promises.forEach((id) => {
        const state = globalContext.promises[id];
        state.promise = state.stored;
        state.consumed = false;
      });
    })
  }
  fetch<T>(resource: string): Promise<T> {
    const id = globalContext.resources[resource];
    if (id !== undefined) {
      const state = globalContext.promises[id];
      if (!this.promises.includes(id)) {
        if (state.status === PromiseStatus.Pending && state.initialized) {
          state.stored = state.promise;
          state.promise = state.cached();
        }
        this.promises.push(id);
      }
      state.consumed = true;
      return state.promise;
    }
    const promise = this.createPromiseState<T>((state) => {
      if (!state.initialized) {
        return new Promise(async (resolve, reject) => {
          try {
            const res = await fetch(resource);
            resolve(await res.json());
          } catch {
            reject();
          }
        })
      }
      return new Promise(() => { });
    });
    globalContext.resources[resource] = promise.id;
    promise.consumed = true;
    return promise.promise;
  }
  createSocket(url: string) {
    const sock = new AsyncWebSocket(new WebSocket(url))
    globalContext.websockets[url] = sock;
    return sock;
  }
  async ws(url: string): Promise<WebSocketContext> {
    const ws = globalContext.websockets[url] ?? this.createSocket(url);
    await ws.openPromise;
    return new WebSocketContext(ws, this);
  }
  state<T>(resource: string, initial: T): Promise<T> {
    if (this.states[resource] !== undefined) {
      if (this.initialVals[resource] !== initial) {
        this.set(resource, initial);
        this.initialVals[resource] = initial;
      }
      const state = globalContext.promises[this.states[resource]];
      state.consumed = true;
      return state.promise;
    }
    this.initialVals[resource] = initial;
    const state = this.createPromiseState<T>((state) => {
      return state.createResolver();
    })
    state.resolve(initial);
    this.states[resource] = state.id;
    state.consumed = true;
    return state.promise;
  }
  set<T>(resource: string, value: T) {
    if (this.states[resource]) {
      const state = globalContext.promises[this.states[resource]];
      if (state.data === value) return;
      if (state.status === PromiseStatus.Fulfilled) {
        state.stored = state.createPromise();
      }
      state.consumed = false;
      state.promise = state.stored;
      state.resolve(value);
    } else {
      this.state(resource, value);
    }
  }
  prop(prop: string, defaultValue: string): Promise<string> {
    if (this.properties[prop] !== undefined) {
      const state = globalContext.promises[this.properties[prop]];
      state.consumed = true;
      return state.promise;
    }
    const state = this.createPromiseState<string>((state) => {
      const promise = state.createResolver();
      return promise;
    })
    state.resolve(defaultValue);
    this.properties[prop] = state.id;
    state.consumed = true;
    return state.promise;
  }
  setProp(prop: string, value: string) {
    const state = globalContext.promises[this.properties[prop]];
    if (state !== undefined) {
      if (state.data === value) return;
      state.consumed = false;
      state.resolve(value);
    } else {
      this.prop(prop, value);
    }
  }
  createPromiseState<T>(promise: Executor<T>) {
    const id = globalContext.promises.length;
    const state = new PromiseState(id, promise);
    globalContext.promises.push(state);
    this.promises.push(id);
    return state;
  }
  restore() {
    this.promises.forEach((id) => {
      const state = globalContext.promises[id];
      if (state.consumed) {
        state.promise = state.createPromise();
        state.stored = state.promise;
        state.consumed = false;
      } else {
        state.promise = state.stored;
      }
    });
  }
  save() {
    this.promises.forEach((id) => {
      const state = globalContext.promises[id];
      if (state.status === PromiseStatus.Pending) {
        state.stored = state.promise;
        state.promise = state.cached();
      } else {
        state.stored = state.createPromise();
      }
    });
  }
  async loop(update: (ctx: Context, h: CreateElement) => Promise<void>) {
    await update(this, this.h.bind(this));
    this.restore();
    while (true) {
      try {
        await Promise.race(this.promises.map(id => globalContext.promises[id].promise));
        this.save();
        await update(this, this.h.bind(this));
        this.restore();
      }
      catch (error) {
        console.error(error)
        this.promises.forEach((id) => {
          const promise = globalContext.promises[id];
          if (promise.status === PromiseStatus.Rejected) {
            let resolve: (value: any) => void;
            let reject: (reason?: any) => void;
            promise.promise = new Promise((_resolve, _reject) => {
              resolve = _resolve;
              reject = _reject
            })
            setTimeout(async () => {
              try {
                promise.data = await promise.executor(promise);
                promise.initialized = true;
                promise.status = PromiseStatus.Fulfilled;
                resolve(promise.data);
              } catch (e) {
                console.log(e)
                promise.status = PromiseStatus.Rejected;
                reject();
              } finally {
              }
            }, 1000);
            promise.stored = promise.promise;
          } else {
            this.restore();
          }
        });
      }
    }
  }
  h: CreateElement = (tag, attrs, ...children) => {
    const element = document.createElement(tag);
    for (const attr in attrs) {
      element.setAttribute(attr, attrs[attr]);
    }
    element.replaceChildren(...children);
    return element;
  }
}

export class AsyncComponent extends HTMLElement {
  name: string = "";
  context = new Context();
  root!: ShadowRoot;
  static observedAttributes: string[] = [];
  constructor() {
    super();
  }
  connectedCallback() {
    let template = document.getElementById(this.name + "-template") as (HTMLTemplateElement | null);
    if (!template) {
      const temp = this.context.h("template", { id: this.name + "-template" });
      temp.content.appendChild(this.template(this.context, this.context.h.bind(this.context)));
      template = document.body.appendChild(temp);
    }
    const shadowRoot = this.attachShadow({ mode: "open" });
    this.root = shadowRoot;
    shadowRoot.appendChild(template.content.cloneNode(true));

    Object.getPrototypeOf(this).constructor.observedAttributes.forEach((attr: string) => {
      const value = this.getAttribute(attr);
      if (value) {
        this.context.setProp(attr, value);
      }
    });
    this.eventListeners(this.context, this.context.h.bind(this.context));
    this.context.loop(this.update.bind(this));
  }
  disconnectedCallback() {

  }
  adoptedCallback() {

  }
  attributeChangedCallback(name: string, oldValue: any, newValue: any) {
    this.context.setProp(name, newValue);
  }
  template(ctx: Context, h: CreateElement): HTMLElement {
    throw new Error("Must implement template");
  }
  async update(ctx: Context, h: CreateElement): Promise<void> {
    throw new Error("Must implement update");
  }
  eventListeners(ctx: Context, h: CreateElement) {
  }
}

class Dropdown extends AsyncComponent {
  name = "await-dropdown";
  static observedAttributes = ["items-url"];

  template(ctx: Context, h: CreateElement) {
    return h("div", {},
      h("select", { id: "select" }),
      h("div", { id: "div" }));
  }

  async update(ctx: Context, h: CreateElement) {
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    const div = this.root.getElementById("div") as HTMLDivElement;
    dropdown.replaceChildren(h("option", {}, "Loading..."));
    div.textContent = "Loading..."
    const itemsUrl = await ctx.prop("items-url", "/items");
    const items = await ctx.fetch<string[]>(itemsUrl);
    const selected = await ctx.state(itemsUrl + "/selected", items[0]);
    dropdown.replaceChildren(...items.map(item => h("option", { value: item }, item)));
    dropdown.value = selected;
    div.textContent = selected;
  }

  eventListeners(ctx: Context) {
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    ctx.addListener(dropdown, "change", async (ctx) => {
      ctx.set(await ctx.prop("items-url", "/items") + "/selected", dropdown.value);
    });
  }
}

class DropdownChanger extends AsyncComponent {
  name = "changer-dropdown";
  static observedAttributes = [];
  template(ctx: Context, h: CreateElement) {
    return h("div", {},
      h("p", {}, "Use this to chagne the url the await dropdown gets it's values from"),
      h("select", { id: "select" }),
      h("div", { id: "div" }),
      h("div", {},
        h("await-dropdown", { id: "await-dropdown" })));
  }

  async update(ctx: Context, h: CreateElement) {
    const items = await ctx.fetch<string[]>("/itemUrls");
    const selected = await ctx.state("/selected", items[0]);
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    const awaitDropdown = this.root.getElementById("await-dropdown")!;
    const div = this.root.getElementById("div") as HTMLDivElement;
    let test = await ctx.state("/testing", 1);
    ctx.set("/testing", 3);
    dropdown.replaceChildren(...items.map(item => h("option", { value: item }, item)));
    dropdown.value = selected;
    awaitDropdown.setAttribute("items-url", selected);
    div.textContent = test.toString();
  }

  eventListeners(ctx: Context) {
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    ctx.addListener(dropdown, "change", async (ctx) => {
      ctx.set("/selected", dropdown.value);
    })
  }
}

class TestElement extends AsyncComponent {
  name = "test-element";
  static observedAttributes = [];
  template(ctx: Context, h: CreateElement) {
    return h("div", { id: "div" });
  }

  async update(ctx: Context) {
    const div = this.root.getElementById("div") as HTMLDivElement;
    let test = await ctx.state("/testing", 1);
    ctx.set("/testing", 3);

    div.textContent = test.toString();
  }
}

customElements.define("await-dropdown", Dropdown);
customElements.define("changer-dropdown", DropdownChanger);
customElements.define("test-element", TestElement);

declare global {
  interface HTMLElementTagNameMap {
    "await-dropdown": Dropdown;
    "changer-dropdown": DropdownChanger;
    "test-element": TestElement;
  }
}
