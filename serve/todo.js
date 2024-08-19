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
  state = 1 /* Pending */;
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
    try {
      this.data = await this.executor(this);
      this.initialized = true;
      this.state = 0 /* Fulfilled */;
      return this.data;
    } catch (e) {
      console.log(e);
      this.state = 2 /* Rejected */;
      throw e;
    } finally {
    }
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
        const promise = globalContext.promises[id];
        if (promise.state === 0 /* Fulfilled */) {
          promise.stored = promise.createPromise();
          promise.state = 1 /* Pending */;
        }
        promise.promise = promise.stored;
        promise.consumed = false;
        globalContext.resolves[promise.id](data.data);
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
  async subscribe(path, payload) {
    const id = this.ws.promises[path];
    if (id !== undefined) {
      const promise2 = globalContext.promises[id];
      if (!this.context.promises.includes(id)) {
        if (promise2.state === 1 /* Pending */ && promise2.initialized) {
          promise2.stored = promise2.promise;
          promise2.promise = new Promise((resolve) => resolve(promise2.data));
        }
        this.context.promises.push(id);
      }
      promise2.consumed = true;
      return promise2.promise;
    }
    await this.ws.openPromise;
    const promise = this.context.createPromise((state) => {
      return new Promise((resolve) => {
        globalContext.resolves[state.id] = resolve;
      });
    });
    this.ws.promises[path] = promise.id;
    promise.consumed = true;
    this.ws.send(JSON.stringify(payload));
    return promise.promise;
  }
  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }
}

class Context {
  promises = [];
  properties = {};
  states = {};
  initialVals = {};
  addListener(element, event, listener) {
    element.addEventListener(event, async (e) => {
      this.promises.forEach((id) => {
        const promise = globalContext.promises[id];
        promise.stored = promise.promise;
        promise.promise = new Promise((resolve) => resolve(promise.data));
      });
      await listener(this, e);
      this.promises.forEach((id) => {
        const promise = globalContext.promises[id];
        promise.promise = promise.stored;
        promise.consumed = false;
      });
    });
  }
  fetch(resource) {
    const id = globalContext.resources[resource];
    if (id !== undefined) {
      const promise2 = globalContext.promises[globalContext.resources[resource]];
      if (!this.promises.includes(id)) {
        if (promise2.state === 1 /* Pending */ && promise2.initialized) {
          promise2.stored = promise2.promise;
          promise2.promise = new Promise((resolve) => resolve(promise2.data));
        }
        this.promises.push(id);
      }
      promise2.consumed = true;
      return promise2.promise;
    }
    const promise = this.createPromise((state) => {
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
  async ws(url) {
    const ws = globalContext.websockets[url];
    if (ws !== undefined) {
      await ws.openPromise;
      return new WebSocketContext(ws, this);
    }
    const sock = new AsyncWebSocket(new WebSocket(url));
    globalContext.websockets[url] = sock;
    await sock.openPromise;
    return new WebSocketContext(sock, this);
  }
  state(resource, initial) {
    if (this.states[resource] !== undefined) {
      if (this.initialVals[resource] !== initial) {
        this.set(resource, initial);
        this.initialVals[resource] = initial;
      }
      const promise2 = globalContext.promises[this.states[resource]];
      promise2.consumed = true;
      return promise2.promise;
    }
    this.initialVals[resource] = initial;
    const promise = this.createPromise((state) => {
      if (!state.initialized) {
        return new Promise((resolve) => {
          resolve(initial);
        });
      }
      return new Promise((resolve) => {
        globalContext.resolves[state.id] = resolve;
      });
    });
    this.states[resource] = promise.id;
    promise.consumed = true;
    return promise.promise;
  }
  set(resource, value) {
    if (this.states[resource]) {
      const promise = globalContext.promises[this.states[resource]];
      if (promise.state === 0 /* Fulfilled */) {
        promise.stored = promise.createPromise();
        promise.state = 1 /* Pending */;
      }
      promise.consumed = false;
      promise.promise = promise.stored;
      globalContext.resolves[this.states[resource]](value);
    } else {
      this.state(resource, value);
    }
  }
  prop(prop, defaultValue) {
    if (this.properties[prop] !== undefined) {
      const promise2 = globalContext.promises[this.properties[prop]];
      promise2.consumed = true;
      return promise2.promise;
    }
    const promise = this.createPromise((state) => {
      if (!state.initialized) {
        return new Promise((resolve) => resolve(defaultValue));
      }
      return new Promise((resolve) => {
        globalContext.resolves[state.id] = resolve;
      });
    });
    this.properties[prop] = promise.id;
    promise.consumed = true;
    return promise.promise;
  }
  setProp(prop, value) {
    if (globalContext.resolves[this.properties[prop]]) {
      globalContext.promises[this.properties[prop]].consumed = false;
      globalContext.resolves[this.properties[prop]](value);
    } else {
      this.prop(prop, value);
    }
  }
  getProp(prop) {
    return globalContext.promises[this.properties[prop]].data;
  }
  createPromise(promise) {
    const id = globalContext.promises.length;
    const state = new PromiseState(id, promise);
    globalContext.promises.push(state);
    this.promises.push(id);
    return state;
  }
  async loop(update) {
    await update(this, this.h.bind(this));
    this.promises.forEach((id) => {
      const promise = globalContext.promises[id];
      if (promise.consumed) {
        promise.promise = promise.createPromise();
        promise.stored = promise.promise;
        promise.state = 1 /* Pending */;
      } else {
        promise.promise = promise.stored;
      }
    });
    while (true) {
      try {
        await Promise.race(this.promises.map((id) => globalContext.promises[id].promise));
        this.promises.forEach((id) => {
          const promise = globalContext.promises[id];
          if (promise.state === 1 /* Pending */) {
            promise.stored = promise.promise;
            promise.promise = new Promise((resolve) => resolve(promise.data));
          } else {
            promise.stored = promise.createPromise();
            promise.state = 1 /* Pending */;
          }
        });
        await update(this, this.h.bind(this));
        this.promises.forEach((id) => {
          const promise = globalContext.promises[id];
          if (promise.consumed) {
            promise.promise = promise.createPromise();
            promise.stored = promise.promise;
            promise.state = 1 /* Pending */;
            promise.consumed = false;
          } else {
            promise.promise = promise.stored;
          }
        });
      } catch (error) {
        console.error(error);
        this.promises.forEach((id) => {
          const promise = globalContext.promises[id];
          if (promise.state === 2 /* Rejected */) {
            let resolve;
            let reject;
            promise.promise = new Promise((_resolve, _reject) => {
              resolve = _resolve;
              reject = _reject;
            });
            setTimeout(async () => {
              try {
                promise.data = await promise.executor(promise);
                promise.initialized = true;
                promise.state = 0 /* Fulfilled */;
                resolve(promise.data);
              } catch (e) {
                console.log(e);
                promise.state = 2 /* Rejected */;
                reject();
              } finally {
              }
            }, 1000);
            promise.stored = promise.promise;
          } else if (promise.consumed) {
            promise.promise = promise.createPromise();
            promise.stored = promise.promise;
            promise.state = 1 /* Pending */;
          } else {
            promise.promise = promise.stored;
          }
        });
      }
    }
  }
  h = (tag, attrs, ...children) => {
    const element = document.createElement(tag);
    for (const attr in attrs) {
      element.setAttribute(attr, attrs[attr]);
    }
    element.replaceChildren(...children);
    return element;
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
    let template = document.getElementById(this.name + "-template");
    if (!template) {
      const temp = this.context.h("template", { id: this.name + "-template" });
      temp.content.appendChild(this.template(this.context, this.context.h.bind(this.context)));
      template = document.body.appendChild(temp);
    }
    const shadowRoot = this.attachShadow({ mode: "open" });
    this.root = shadowRoot;
    shadowRoot.appendChild(template.content.cloneNode(true));
    Object.getPrototypeOf(this).constructor.observedAttributes.forEach((attr) => {
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
  attributeChangedCallback(name, oldValue, newValue) {
    this.context.setProp(name, newValue);
  }
  template(ctx, h) {
    throw new Error("Must implement template");
  }
  async update(ctx, h) {
    throw new Error("Must implement update");
  }
  eventListeners(ctx, h) {
  }
}

class Dropdown extends AsyncComponent {
  name = "await-dropdown";
  static observedAttributes = ["items-url"];
  template(ctx, h) {
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
    if (test !== 3) {
      ctx.set("/testing", 3);
    }
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
    if (test !== 3) {
      ctx.set("/testing", 3);
    }
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
  async update(ctx, h) {
    const list = this.root.getElementById("list");
    const ws = await ctx.ws("/wss");
    const todos = await ws.subscribe("/todos", { type: 4 /* SubscribeTodos */ });
    list.replaceChildren(...todos.map((todoId) => h("todo-item", { "todo-id": todoId })));
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
    const todo = await ws.subscribe(`/todo/${todoId}`, { type: 3 /* SubscribeTodo */, id: Number.parseInt(todoId) });
    done.checked = todo.done;
    text.textContent = todo.text;
  }
  eventListeners(ctx, h) {
    const done = this.root.getElementById("done");
    const deleteTodo = this.root.getElementById("delete");
    ctx.addListener(done, "change", async (ctx2) => {
      const ws = await ctx2.ws("/wss");
      const todoId = await ctx2.prop("todo-id", "0");
      const todo = await ws.subscribe(`/todo/${todoId}`, { type: 3 /* SubscribeTodo */, id: Number.parseInt(todoId) });
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
