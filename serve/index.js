// index.ts
var globalContext = {
  resources: {},
  resolves: {},
  promises: []
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

class Context {
  addListener(element, event, listener) {
    element.addEventListener(event, async (e) => {
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
      await listener(this, e);
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
    });
  }
  promises = [];
  properties = {};
  states = {};
  initialVals = {};
  fetch(resource) {
    const id = globalContext.resources[resource];
    if (id !== undefined) {
      const promise2 = globalContext.promises[globalContext.resources[resource]];
      if (!this.promises.includes(id)) {
        if (promise2.state == 1 /* Pending */ && promise2.initialized) {
          promise2.stored = promise2.promise;
          promise2.promise = new Promise((resolve) => resolve(promise2.data));
        }
        promise2.consumed = true;
        this.promises.push(id);
      }
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
    await update(this);
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
        await update(this);
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
      const temp = document.createElement("template");
      temp.innerHTML = this.template();
      temp.id = this.name + "-template";
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
    this.eventListeners(this.context);
    this.context.loop(this.update.bind(this));
  }
  disconnectedCallback() {
  }
  adoptedCallback() {
  }
  attributeChangedCallback(name, oldValue, newValue) {
    this.context.setProp(name, newValue);
  }
  template() {
    throw new Error("Must implement template");
  }
  async update(ctx) {
    throw new Error("Must implement update");
  }
  eventListeners(ctx) {
  }
}
var html = (strings, ...values) => String.raw({ raw: strings }, ...values);

class Dropdown extends AsyncComponent {
  name = "await-dropdown";
  static observedAttributes = ["items-url"];
  template() {
    return html`
      <div>
        <select id="select">
        </select>
        <div id="div"></div>
      </div>
    `;
  }
  async update(ctx) {
    const dropdown = this.root.getElementById("select");
    const div = this.root.getElementById("div");
    dropdown.innerHTML = html`<option>Loading...</option>`;
    div.textContent = "Loading...";
    const itemsUrl = await ctx.prop("items-url", "/items");
    const items = await ctx.fetch(itemsUrl);
    const selected = await ctx.state(itemsUrl + "/selected", items[0]);
    dropdown.innerHTML = items.map((item) => html`
      <option value=${item}>${item}</option>
    `).join();
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
  template() {
    return html`
      <div>
        <p>Use this to change the url the await dropdown gets it's values from<p>
        <select id="select">
        </select>
        <div id="div"></div>
        <div>
          <await-dropdown id="await-dropdown"></await-dropdown>
        </div>
      </div>
    `;
  }
  async update(ctx) {
    const items = await ctx.fetch("/itemUrls");
    const selected = await ctx.state("/selected", items[0]);
    const dropdown = this.root.getElementById("select");
    const awaitDropdown = this.root.getElementById("await-dropdown");
    const div = this.root.getElementById("div");
    let test = await ctx.state("/testing", 1);
    if (test !== 3) {
      ctx.set("/testing", 3);
    }
    dropdown.innerHTML = items.map((item) => html`
      <option value=${item}>${item}</option>
    `).join();
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
  template() {
    return html`
      <div id="div"></div>
    `;
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
