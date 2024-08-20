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
  store = false;
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
      if (!this.context.promises.has(id)) {
        if (state.status === PromiseStatus.Pending && state.initialized) {
          state.stored = state.promise;
          state.promise = state.cached();
        }
        this.context.promises.add(id);
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

export type CreateElement = <T extends keyof HTMLElementTagNameMap>(tag: T, attributes?: any, ...children: any[]) => { tag: T, attributes: any, children: any[] };
class InnerContext {
  properties: Record<string, number> = {};
  states: Record<string, number> = {};
  initialVals: Record<string, any> = {};
  attributes: Set<{ element: HTMLElement, attribute: string, executor: (context: Context) => Promise<any> }> = new Set();
  renderables: Set<{ parent: Node, index?: number, executor: (context: Context) => Promise<any> }> = new Set();
}
export class Context {
  i = new InnerContext();
  promises = new Set<number>;
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
  create<T>(executor: (ctx: Context, h: CreateElement) => Promise<T>): (ctx: Context) => Promise<T> {
    return (ctx: Context) => executor(ctx, ctx.h.bind(this.h));

  }
  fetch<T>(resource: string): Promise<T> {
    const id = globalContext.resources[resource];
    if (id !== undefined) {
      const state = globalContext.promises[id];
      if (!this.promises.has(id)) {
        if (state.status === PromiseStatus.Pending && state.initialized) {
          state.stored = state.promise;
          state.status = PromiseStatus.Fulfilled;
          state.promise = state.cached();
        }
        this.promises.add(id);
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
    const id = this.i.states[resource];
    if (id !== undefined) {
      if (this.i.initialVals[resource] !== initial) {
        this.set(resource, initial);
        this.i.initialVals[resource] = initial;
      }
      const state = globalContext.promises[id];
      if (!this.promises.has(id)) {
        this.promises.add(id);
      }
      state.consumed = true;
      return state.promise;
    }
    this.i.initialVals[resource] = initial;
    const state = this.createPromiseState<T>((state) => {
      return state.createResolver();
    })
    state.resolve(initial);
    this.i.states[resource] = state.id;
    state.consumed = true;
    return state.promise;
  }
  set<T>(resource: string, value: T) {
    if (this.i.states[resource]) {
      const state = globalContext.promises[this.i.states[resource]];
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
    const id = this.i.properties[prop];
    if (id !== undefined) {
      const state = globalContext.promises[id];
      if (!this.promises.has(id)) {
        this.promises.add(id);
      }
      state.consumed = true;
      return state.promise;
    }
    const state = this.createPromiseState<string>((state) => {
      const promise = state.createResolver();
      return promise;
    })
    state.resolve(defaultValue);
    this.i.properties[prop] = state.id;
    state.consumed = true;
    return state.promise;
  }
  setProp(prop: string, value: string) {
    const state = globalContext.promises[this.i.properties[prop]];
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
    this.promises.add(id);
    return state;
  }
  restore() {
    this.promises.forEach((id) => {
      const state = globalContext.promises[id];
      if (state.consumed && state.status === PromiseStatus.Fulfilled) {
        state.promise = state.createPromise();
        state.stored = state.promise;
      } else {
        state.promise = state.stored;
      }
      state.consumed = false;
      state.store = false;
    });
  }
  save() {
    this.promises.forEach((id) => {
      const state = globalContext.promises[id];
      if (state.store) return;
      if (state.status === PromiseStatus.Pending) {
        state.stored = state.promise;
        state.promise = state.cached();
      } else {
        state.stored = state.createPromise();
      }
      state.store = true;
    });
  }

  addAttribute(element: HTMLElement, attribute: string, value: any) {
    console.log(attribute, value);

    if (attribute[0] === "o" && attribute[1] === "n") {
      this.addListener(element, attribute.slice(2).toLowerCase(), value)
    } else if (typeof value === "function") {
      this.i.attributes.add({ element, attribute, executor: value })
    } else if (attribute in element) {
      element[attribute] = value;
    } else {
      if (value === false) {
        element.removeAttribute(attribute);
      } else {
        element.setAttribute(attribute, value);
      }
    }
  }
  addAttributes(element: HTMLElement, attributes: any) {
    for (const attribute in attributes) {
      this.addAttribute(element, attribute, attributes[attribute]);
    }
  }

  setup(parent: Node, child?: any | any[], childrenSet?: Map<any, Node> | number) {
    const index = childrenSet;
    if (child === undefined) {
      return;
    } else if (typeof child === "function") {
      this.i.renderables.add({ parent, executor: child, index: typeof index === "number" ? index : undefined });
    } else if (Array.isArray(child)) {
      const toAdd = new Map(child.map(c => [c.attributes?.key, c]));
      if (toAdd.size === 1 && toAdd.has(undefined)) {
        child.forEach((child, index) => {
          this.setup(parent, child, index);
        });
        for (let i = parent.childNodes.length - 1; i >= child.length; i--) {
          parent.childNodes[i].remove();
        }
      } else {
        for (const todo of parent.childrenSet.keys()) {
          if (!toAdd.has(todo)) {
            parent.childrenSet.get(todo)!.remove();
            parent.childrenSet.delete(todo);
          } else {
            toAdd.delete(todo);
          }
        }
        toAdd.forEach(child => {
          this.setup(parent, child, parent.childrenSet);
        })
      }
    } else {
      let element;
      if (typeof child !== "object") {
        element = document.createTextNode(child);
      } else {
        element = document.createElement(child.tag);
      }
      if (parent.childrenSet?.size > 0 || childrenSet instanceof Map) {
        parent.appendChild(element);
        child.attributes?.key !== undefined && childrenSet?.set(child.attributes.key, element);
      } else {
        if (typeof index === "number" && parent.childNodes[index] !== undefined) {
          parent.replaceChild(element, parent.childNodes[index]);
        } else {
          parent.appendChild(element);
        }
      }
      this.addAttributes(element, child.attributes);
      element.childrenSet = new Map();
      this.setup(element, child.children);
    }
  }
  resolve: (value: any) => void = () => { };
  async loop(render: (ctx: Context, h: CreateElement) => ReturnType<CreateElement>, el: AsyncComponent) {
    let tree = render(this, this.h.bind(this));
    let parent = el.root;
    this.setup(parent, tree)
    for (const attribute of this.i.attributes) {
      (async () => {
        const ctx = new Context();
        ctx.i = this.i;
        ctx.resolve = ((attr) => this.addAttribute(attribute.element, attribute.attribute, attr))
        const attr = await attribute.executor(ctx);
        ctx.resolve(attr);
        ctx.restore();
        ctx.promises.forEach(id => this.promises.add(id));
        while (true) {
          await Promise.race(Array.from(ctx.promises.keys()).map(id => globalContext.promises[id].promise));
          ctx.save();
          const attr = await attribute.executor(ctx);
          ctx.promises.forEach(id => this.promises.add(id));
          ctx.resolve(attr);
          ctx.restore();
        }
      })();
    }
    for (const render of this.i.renderables) {
      (async () => {
        const ctx = new Context();
        ctx.i = this.i;
        ctx.resolve = (value) => this.setup(render.parent, value, render.index)
        const el = await render.executor(ctx);
        ctx.promises.forEach(id => this.promises.add(id));
        ctx.resolve(el);
        ctx.restore();
        while (true) {
          await Promise.race(Array.from(ctx.promises.keys()).map(id => globalContext.promises[id].promise));
          ctx.save();
          const el = await render.executor(ctx);
          ctx.promises.forEach(id => this.promises.add(id));
          ctx.resolve(el);
          ctx.restore();
        }
      })()
    };
  }
  h: CreateElement = (tag, attributes, ...children) => {
    return { tag, attributes, children };
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
    const shadowRoot = this.attachShadow({ mode: "open" });
    this.root = shadowRoot;

    Object.getPrototypeOf(this).constructor.observedAttributes.forEach((attr: string) => {
      const value = this.getAttribute(attr);
      if (value) {
        this.context.setProp(attr, value);
      }
    });
    this.context.loop(this.render.bind(this), this);
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
  render(ctx: Context, h: CreateElement): ReturnType<CreateElement> {
    throw new Error("Must implement update");
  }
}

class Dropdown extends AsyncComponent {
  name = "await-dropdown";
  static observedAttributes = ["items-url"];

  render(ctx: Context, h: CreateElement) {
    const itemsUrl = ctx.create((ctx: Context) => ctx.prop("items-url", "/items"));
    const items = ctx.create(async (ctx: Context) => {
      ctx.resolve(h("option", {value: "Loading..."}, "Loading..."));
      return ctx.fetch<string[]>(await itemsUrl(ctx));
    })
    const selected = ctx.create(async (ctx: Context) => {
      const itemsPromise = items(ctx);
      ctx.resolve("Loading...");
      return ctx.state(await itemsUrl(ctx) + "/selected", (await itemsPromise)[0])
    })
    return h("div", {},
      h("select", {
        onChange: async (ctx: Context, ev: any) => {
          ctx.set(await itemsUrl(ctx) + "/selected", ev.target.value);
        },
        value: selected,
      }, async (ctx: Context) =>
        (await items(ctx)).map(item => h("option", { value: item }, item))),
      h("div", {}, selected),
      h("div", {}, async (ctx: Context) => {
        let test = await ctx.state("/testing", 1);
        ctx.set("/testing", 3);
        return test;
      }),
    );
  }
}

class DropdownChanger extends AsyncComponent {
  name = "changer-dropdown";
  static observedAttributes = [];
  render(ctx: Context, h: CreateElement) {
    const items = ctx.create((ctx: Context) => {
      return ctx.fetch<string[]>("/itemUrls")
    })
    const selected = ctx.create(async (ctx: Context) => {
      return ctx.state("/selected", (await items(ctx))[0])
    })
    return h("div", {},
      h("p", {}, "Use this to chagne the url the await dropdown gets it's values from"),
      h("select", {
        onChange: (ctx: Context, ev: any) => {
          ctx.set("/selected", ev.target.value);
        },
        value: selected,
      }, async (ctx: Context) =>
        (await items(ctx)).map(item => h("option", { value: item }, item))),
      h("div", {}, async () => {
        let test = await ctx.state("/testing", 1);
        ctx.set("/testing", 3);
        return test;
      }),
      h("div", {},
        h("await-dropdown", { "items-url": selected })));
  }
}

class TestElement extends AsyncComponent {
  name = "test-element";
  static observedAttributes = [];
  render(ctx: Context, h: CreateElement) {
    return h("div", {}, async (ctx: Context) => {
      let test = await ctx.state("/testing", 1);
      ctx.set("/testing", 3);
      return test;
    });
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
