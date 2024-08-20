// index.ts
var globalContext = {
  resources: {},
  resolves: {},
  promises: [],
  websockets: {}
};
var NOT_INITIALIZED = Symbol("Data not initialized");

class PromiseState {
  data = NOT_INITIALIZED;
  initialized = false;
  consumed = false;
  store = false;
  status = 1 /* Pending */;
  promise;
  stored;
  executor;
  id;
  constructor(id, executor) {
    this.id = id;
    this.executor = executor;
    this.promise = this.createPromise();
    this.stored ??= this.promise;
  }
  async createPromise() {
    this.status = 1 /* Pending */;
    try {
      this.data = await this.executor(this);
      this.initialized = true;
      this.status = 0 /* Fulfilled */;
      return this.data;
    } catch (e) {
      console.log(e);
      this.status = 2 /* Rejected */;
      throw e;
    } finally {
    }
  }
  createResolver() {
    return new Promise((resolve) => {
      globalContext.resolves[this.id] = resolve;
    });
  }
  resolve(value) {
    globalContext.resolves[this.id](value);
  }
  cached() {
    return Promise.resolve(this.data);
  }
}

class AsyncWebSocket {
  ws;
  openPromise;
  promises = {};
  constructor(ws) {
    this.ws = ws;
    let _resolve;
    let _reject;
    this.openPromise = new Promise((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });
    this.ws.addEventListener("open", () => {
      _resolve();
    });
    this.ws.addEventListener("message", (ev) => {
      const data = JSON.parse(ev.data);
      console.log(data);
      const id = this.promises[data.path];
      if (id !== undefined) {
        const state = globalContext.promises[id];
        if (state.status === 0 /* Fulfilled */) {
          state.stored = state.createPromise();
        }
        state.promise = state.stored;
        globalContext.resolves[state.id](data.data);
      }
    });
  }
  send(payload) {
    this.ws.send(payload);
  }
}

class WebSocketContext {
  ws;
  context;
  constructor(ws, context) {
    this.ws = ws;
    this.context = context;
  }
  async subscribe(path) {
    const id = this.ws.promises[path];
    if (id !== undefined) {
      const state = globalContext.promises[id];
      if (!this.context.promises.has(id)) {
        if (state.status === 1 /* Pending */ && state.initialized) {
          state.stored = state.promise;
          state.promise = state.cached();
        }
        this.context.promises.add(id);
      }
      state.consumed = true;
      return state.promise;
    }
    const promise = this.context.createPromiseState(async (state) => {
      return state.createResolver();
    });
    this.ws.promises[path] = promise.id;
    promise.consumed = true;
    await this.ws.openPromise;
    this.ws.send(JSON.stringify({ type: 3 /* Subscribe */, path }));
    return promise.promise;
  }
  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }
}

class InnerContext {
  properties = {};
  states = {};
  initialVals = {};
  attributes = new Set;
  renderables = new Set;
}

class Context {
  i = new InnerContext;
  promises = new Set;
  addListener(element, event, listener) {
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
    });
  }
  create(executor) {
    return (ctx) => executor(ctx, ctx.h.bind(this.h));
  }
  fetch(resource) {
    const id = globalContext.resources[resource];
    if (id !== undefined) {
      const state = globalContext.promises[id];
      if (!this.promises.has(id)) {
        if (state.status === 1 /* Pending */ && state.initialized) {
          state.stored = state.promise;
          state.promise = state.cached();
        }
        this.promises.add(id);
      }
      state.consumed = true;
      return state.promise;
    }
    const promise = this.createPromiseState((state) => {
      if (!state.initialized) {
        return new Promise(async (resolve, reject) => {
          try {
            const res = await fetch(resource);
            resolve(await res.json());
          } catch {
            reject();
          }
        });
      }
      return new Promise(() => {
      });
    });
    globalContext.resources[resource] = promise.id;
    promise.consumed = true;
    return promise.promise;
  }
  createSocket(url) {
    const sock = new AsyncWebSocket(new WebSocket(url));
    globalContext.websockets[url] = sock;
    return sock;
  }
  async ws(url) {
    const ws = globalContext.websockets[url] ?? this.createSocket(url);
    await ws.openPromise;
    return new WebSocketContext(ws, this);
  }
  state(resource, initial) {
    const id = this.i.states[resource];
    if (id !== undefined) {
      if (this.i.initialVals[resource] !== initial) {
        this.set(resource, initial);
        this.i.initialVals[resource] = initial;
      }
      const state2 = globalContext.promises[id];
      if (!this.promises.has(id)) {
        this.promises.add(id);
      }
      state2.consumed = true;
      return state2.promise;
    }
    this.i.initialVals[resource] = initial;
    const state = this.createPromiseState((state2) => {
      return state2.createResolver();
    });
    state.resolve(initial);
    this.i.states[resource] = state.id;
    state.consumed = true;
    return state.promise;
  }
  set(resource, value) {
    if (this.i.states[resource]) {
      const state = globalContext.promises[this.i.states[resource]];
      if (state.data === value)
        return;
      if (state.status === 0 /* Fulfilled */) {
        state.stored = state.createPromise();
      }
      state.consumed = false;
      state.promise = state.stored;
      state.resolve(value);
    } else {
      this.state(resource, value);
    }
  }
  prop(prop, defaultValue) {
    const id = this.i.properties[prop];
    if (id !== undefined) {
      const state2 = globalContext.promises[id];
      if (!this.promises.has(id)) {
        this.promises.add(id);
      }
      state2.consumed = true;
      return state2.promise;
    }
    const state = this.createPromiseState((state2) => {
      const promise = state2.createResolver();
      return promise;
    });
    state.resolve(defaultValue);
    this.i.properties[prop] = state.id;
    state.consumed = true;
    return state.promise;
  }
  setProp(prop, value) {
    const state = globalContext.promises[this.i.properties[prop]];
    if (state !== undefined) {
      if (state.data === value)
        return;
      state.consumed = false;
      state.resolve(value);
    } else {
      this.prop(prop, value);
    }
  }
  createPromiseState(promise) {
    const id = globalContext.promises.length;
    const state = new PromiseState(id, promise);
    globalContext.promises.push(state);
    this.promises.add(id);
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
      state.store = false;
    });
  }
  save() {
    this.promises.forEach((id) => {
      const state = globalContext.promises[id];
      if (state.store)
        return;
      if (state.status === 1 /* Pending */) {
        state.stored = state.promise;
        state.promise = state.cached();
      } else {
        state.stored = state.createPromise();
      }
      state.store = true;
    });
  }
  addAttribute(element, attribute, value) {
    if (attribute[0] === "o" && attribute[1] === "n") {
      this.addListener(element, attribute.slice(2).toLowerCase(), value);
    } else if (typeof value === "function") {
      this.i.attributes.add({ element, attribute, executor: value });
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
  addAttributes(element, attributes) {
    for (const attribute in attributes) {
      this.addAttribute(element, attribute, attributes[attribute]);
    }
  }
  setup(parent, child, childrenSet) {
    const index = childrenSet;
    if (child === undefined) {
      return;
    } else if (typeof child === "function") {
      this.i.renderables.add({ parent, executor: child, index: typeof index === "number" ? index : undefined });
    } else if (Array.isArray(child)) {
      const toAdd = new Map(child.map((c) => [c.attributes?.key, c]));
      if (toAdd.size === 1 && toAdd.has(undefined)) {
        child.forEach((child2, index2) => {
          this.setup(parent, child2, index2);
        });
      } else {
        for (const todo of parent.childrenSet.keys()) {
          if (!toAdd.has(todo)) {
            parent.childrenSet.get(todo).remove();
            parent.childrenSet.delete(todo);
          } else {
            toAdd.delete(todo);
          }
        }
        toAdd.forEach((child2) => {
          this.setup(parent, child2, parent.childrenSet);
        });
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
      element.childrenSet = new Map;
      this.setup(element, child.children);
    }
  }
  async loop(render, el) {
    let tree = render(this, this.h.bind(this));
    let parent = el.root;
    this.setup(parent, tree);
    for (const attribute of this.i.attributes) {
      (async () => {
        const ctx = new Context;
        ctx.i = this.i;
        const attr = await attribute.executor(ctx);
        this.addAttribute(attribute.element, attribute.attribute, attr);
        ctx.restore();
        ctx.promises.forEach((id) => this.promises.add(id));
        while (true) {
          await Promise.race(Array.from(ctx.promises.keys()).map((id) => globalContext.promises[id].promise));
          ctx.save();
          const attr2 = await attribute.executor(ctx);
          ctx.promises.forEach((id) => this.promises.add(id));
          this.addAttribute(attribute.element, attribute.attribute, attr2);
          ctx.restore();
        }
      })();
    }
    for (const render2 of this.i.renderables) {
      (async () => {
        const ctx = new Context;
        ctx.i = this.i;
        const el2 = await render2.executor(ctx);
        ctx.promises.forEach((id) => this.promises.add(id));
        this.setup(render2.parent, el2, render2.index);
        ctx.restore();
        while (true) {
          await Promise.race(Array.from(ctx.promises.keys()).map((id) => globalContext.promises[id].promise));
          ctx.save();
          const el3 = await render2.executor(ctx);
          ctx.promises.forEach((id) => this.promises.add(id));
          this.setup(render2.parent, el3, render2.index);
          ctx.restore();
        }
      })();
    }
  }
  h = (tag, attributes, ...children) => {
    return { tag, attributes, children };
  };
}

class AsyncComponent extends HTMLElement {
  name = "";
  context = new Context;
  root;
  static observedAttributes = [];
  constructor() {
    super();
  }
  connectedCallback() {
    const shadowRoot = this.attachShadow({ mode: "open" });
    this.root = shadowRoot;
    Object.getPrototypeOf(this).constructor.observedAttributes.forEach((attr) => {
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
  attributeChangedCallback(name, oldValue, newValue) {
    this.context.setProp(name, newValue);
  }
  template(ctx, h) {
    throw new Error("Must implement template");
  }
  render(ctx, h) {
    throw new Error("Must implement update");
  }
}

class Dropdown extends AsyncComponent {
  name = "await-dropdown";
  static observedAttributes = ["items-url"];
  render(ctx, h) {
    const itemsUrl = ctx.create((ctx2) => ctx2.prop("items-url", "/items"));
    const items = ctx.create(async (ctx2) => {
      return ctx2.fetch(await itemsUrl(ctx2));
    });
    const selected = ctx.create(async (ctx2) => {
      return ctx2.state(await itemsUrl(ctx2) + "/selected", (await items(ctx2))[0]);
    });
    return h("div", {}, h("select", {
      onChange: async (ctx2, ev) => {
        ctx2.set(await itemsUrl(ctx2) + "/selected", ev.target.value);
      },
      value: selected
    }, async (ctx2) => (await items(ctx2)).map((item) => h("option", { value: item }, item))), h("div", {}, selected), h("div", {}, async (ctx2) => {
      let test = await ctx2.state("/testing", 1);
      ctx2.set("/testing", 3);
      return test;
    }));
  }
}

class DropdownChanger extends AsyncComponent {
  name = "changer-dropdown";
  static observedAttributes = [];
  render(ctx, h) {
    const items = ctx.create((ctx2) => {
      return ctx2.fetch("/itemUrls");
    });
    const selected = ctx.create(async (ctx2) => {
      return ctx2.state("/selected", (await items(ctx2))[0]);
    });
    return h("div", {}, h("p", {}, "Use this to chagne the url the await dropdown gets it's values from"), h("select", {
      onChange: (ctx2, ev) => {
        ctx2.set("/selected", ev.target.value);
      },
      value: selected
    }, async (ctx2) => (await items(ctx2)).map((item) => h("option", { value: item }, item))), h("div", {}, async () => {
      let test = await ctx.state("/testing", 1);
      ctx.set("/testing", 3);
      return test;
    }), h("div", {}, h("await-dropdown", { "items-url": selected })));
  }
}

class TestElement extends AsyncComponent {
  name = "test-element";
  static observedAttributes = [];
  render(ctx, h) {
    return h("div", {}, async (ctx2) => {
      let test = await ctx2.state("/testing", 1);
      ctx2.set("/testing", 3);
      return test;
    });
  }
}
customElements.define("await-dropdown", Dropdown);
customElements.define("changer-dropdown", DropdownChanger);
customElements.define("test-element", TestElement);
export {
  Context,
  AsyncComponent
};
