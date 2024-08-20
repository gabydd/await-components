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
    if (this.i.states[resource] !== undefined) {
      if (this.i.initialVals[resource] !== initial) {
        this.set(resource, initial);
        this.i.initialVals[resource] = initial;
      }
      const state2 = globalContext.promises[this.i.states[resource]];
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
    if (this.i.properties[prop] !== undefined) {
      const state2 = globalContext.promises[this.i.properties[prop]];
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
    });
  }
  save() {
    this.promises.forEach((id) => {
      const state = globalContext.promises[id];
      if (state.status === 1 /* Pending */) {
        state.stored = state.promise;
        state.promise = state.cached();
      } else {
        state.stored = state.createPromise();
      }
    });
  }
  async addAttributes(element, attributes) {
    for (const attribute in attributes) {
      if (attribute[0] === "o" && attribute[1] === "n") {
        this.addListener(element, attribute.slice(2).toLowerCase(), attributes[attribute]);
      }
      if (typeof attributes[attribute] === "function") {
        this.i.attributes.add({ element, attribute, executor: attributes[attribute] });
      } else {
        element.setAttribute(attribute, attributes[attribute]);
      }
    }
  }
  setup(parent, child, index) {
    if (child === undefined) {
      return;
    } else if (typeof child === "function") {
      this.i.renderables.add({ parent, index: index ?? 0, executor: child });
    } else if (Array.isArray(child)) {
      for (let i = 0;i < child.length; i++) {
        this.setup(parent, child[i], i);
      }
    } else {
      const element = document.createElement(child.tag);
      parent.appendChild(element);
      this.addAttributes(element, child.attributes);
      this.setup(parent, child[2]);
    }
  }
  async loop(render, el) {
    let tree = render(this, this.h.bind(this));
    let parent = el.root;
    this.setup(parent, tree);
    for (const attribute of this.i.attributes) {
    }
    for (const render2 of this.i.renderables) {
    }
    this.restore();
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
    return h("div", {}, h("select", { id: "select" }), h("div", { id: "div" }));
  }
  async update(ctx, h) {
    const dropdown = this.root.getElementById("select");
    const div = this.root.getElementById("div");
    dropdown.replaceChildren(h("option", {}, "Loading..."));
    div.textContent = "Loading...";
    const itemsUrl = await ctx.prop("items-url", "/items");
    const items = await ctx.fetch(itemsUrl);
    const selected = await ctx.state(itemsUrl + "/selected", items[0]);
    dropdown.replaceChildren(...items.map((item) => h("option", { value: item }, item)));
    dropdown.value = selected;
    div.textContent = selected;
  }
  eventListeners(ctx) {
    const dropdown = this.root.getElementById("select");
    ctx.addListener(dropdown, "change", async (ctx2) => {
      ctx2.set(await ctx2.prop("items-url", "/items") + "/selected", dropdown.value);
    });
  }
}

class DropdownChanger extends AsyncComponent {
  name = "changer-dropdown";
  static observedAttributes = [];
  template(ctx, h) {
    return h("div", {}, h("p", {}, "Use this to chagne the url the await dropdown gets it's values from"), h("select", { id: "select" }), h("div", { id: "div" }), h("div", {}, h("await-dropdown", { id: "await-dropdown" })));
  }
  async update(ctx, h) {
    const items = await ctx.fetch("/itemUrls");
    const selected = await ctx.state("/selected", items[0]);
    const dropdown = this.root.getElementById("select");
    const awaitDropdown = this.root.getElementById("await-dropdown");
    const div = this.root.getElementById("div");
    let test = await ctx.state("/testing", 1);
    ctx.set("/testing", 3);
    dropdown.replaceChildren(...items.map((item) => h("option", { value: item }, item)));
    dropdown.value = selected;
    awaitDropdown.setAttribute("items-url", selected);
    div.textContent = test.toString();
  }
  eventListeners(ctx) {
    const dropdown = this.root.getElementById("select");
    ctx.addListener(dropdown, "change", async (ctx2) => {
      ctx2.set("/selected", dropdown.value);
    });
  }
}

class TestElement extends AsyncComponent {
  name = "test-element";
  static observedAttributes = [];
  template(ctx, h) {
    return h("div", { id: "div" });
  }
  async update(ctx) {
    const div = this.root.getElementById("div");
    let test = await ctx.state("/testing", 1);
    ctx.set("/testing", 3);
    div.textContent = test.toString();
  }
}
customElements.define("await-dropdown", Dropdown);
customElements.define("changer-dropdown", DropdownChanger);
customElements.define("test-element", TestElement);

// todo.ts
class Layout extends AsyncComponent {
  name = "todos-layout";
  template(ctx, h) {
    return h("div", {}, h("div", {}, h("input", { type: "text", id: "text" }), h("button", { id: "create" }, "Create Todo")), h("div", { id: "list" }));
  }
  todoChildren = new Map;
  async update(ctx, h) {
    const list = this.root.getElementById("list");
    const ws = await ctx.ws("/wss");
    const todos = await ws.subscribe("/todos");
    const toAdd = new Set(todos);
    for (const todo of this.todoChildren.keys()) {
      if (!toAdd.has(todo)) {
        this.todoChildren.get(todo).remove();
        this.todoChildren.delete(todo);
      } else {
        toAdd.delete(todo);
      }
    }
    for (const todo of toAdd.keys()) {
      this.todoChildren.set(todo, list.appendChild(h("todo-item", { "todo-id": todo })));
    }
  }
  eventListeners(ctx, h) {
    const text = this.root.getElementById("text");
    const create = this.root.getElementById("create");
    ctx.addListener(create, "click", async (ctx2) => {
      const ws = await ctx2.ws("/wss");
      ws.send({ type: 0 /* CreateTodo */, text: text.value });
    });
  }
}

class TodoItem extends AsyncComponent {
  name = "todo-item";
  static observedAttributes = ["todo-id"];
  template(ctx, h) {
    return h("div", {}, h("input", { id: "done", type: "checkbox" }), h("span", { id: "text" }), h("button", { id: "delete" }, "Delete"));
  }
  async update(ctx, h) {
    const done = this.root.getElementById("done");
    const text = this.root.getElementById("text");
    const ws = await ctx.ws("/wss");
    const todoId = await ctx.prop("todo-id", "0");
    const todo = await ws.subscribe(`/todo/${todoId}`);
    done.checked = todo.done;
    text.textContent = todo.text;
  }
  eventListeners(ctx, h) {
    const done = this.root.getElementById("done");
    const deleteTodo = this.root.getElementById("delete");
    ctx.addListener(done, "change", async (ctx2) => {
      const ws = await ctx2.ws("/wss");
      const todoId = await ctx2.prop("todo-id", "0");
      const todo = await ws.subscribe(`/todo/${todoId}`);
      todo.done = done.checked;
      ws.send({ type: 2 /* UpdateTodo */, todo });
    });
    ctx.addListener(deleteTodo, "click", async (ctx2) => {
      const ws = await ctx2.ws("/wss");
      const todoId = await ctx2.prop("todo-id", "0");
      ws.send({ type: 1 /* RemoveTodo */, id: Number.parseInt(todoId) });
    });
  }
}
customElements.define("todos-layout", Layout);
customElements.define("todo-item", TodoItem);
