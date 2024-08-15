// index.ts
var NOT_INITIALIZED = Symbol("Data not initialized");

class PromiseState {
  data = NOT_INITIALIZED;
  initialized = false;
  state = 0 /* Pending */;
  promise;
  stored;
  executor;
  id;
  constructor(id, executor) {
    this.id = id;
    this.executor = executor;
    this.promise = this.createPromise();
    this.stored = this.promise;
  }
  createPromise() {
    return new Promise(async (resolve, reject) => {
      try {
        this.data = await this.executor(this);
        this.initialized = true;
        this.state = 1 /* Fulfilled */;
        resolve(this.data);
      } catch (e) {
        this.state = 2 /* Rejected */;
        console.log(e);
        reject();
      } finally {
        this.promise = this.createPromise();
        this.stored = this.promise;
        this.state = 0 /* Pending */;
      }
    });
  }
}

class Context {
  promises = [];
  resources = {};
  properties = {};
  resolves = {};
  initialVals = {};
  fetch(resource) {
    if (this.resources[resource] !== undefined) {
      return this.promises[this.resources[resource]].promise;
    }
    const promise = this.createPromise((state) => {
      if (!state.initialized) {
        return new Promise(async (resolve, reject) => {
          const res = await fetch(resource);
          resolve(await res.json());
        });
      }
      return new Promise(() => {
      });
    });
    this.resources[resource] = promise.id;
    return promise.promise;
  }
  state(resource, initial) {
    if (this.resources[resource] !== undefined) {
      if (this.initialVals[resource] !== initial) {
        this.set(resource, initial);
        this.initialVals[resource] = initial;
      }
      return this.promises[this.resources[resource]].promise;
    }
    this.initialVals[resource] = initial;
    const promise = this.createPromise((state) => {
      if (!state.initialized) {
        return new Promise((resolve) => resolve(initial));
      }
      return new Promise((resolve) => {
        this.resolves[state.id] = resolve;
      });
    });
    this.resources[resource] = promise.id;
    return promise.promise;
  }
  set(resource, value) {
    if (this.resolves[this.resources[resource]]) {
      const promise = this.promises[this.resources[resource]];
      promise.promise = promise.stored;
      this.resolves[this.resources[resource]](value);
    } else {
      this.state(resource, value);
    }
  }
  prop(prop, defaultValue) {
    if (this.properties[prop] !== undefined) {
      return this.promises[this.properties[prop]].promise;
    }
    const promise = this.createPromise((state) => {
      if (!state.initialized) {
        return new Promise((resolve) => resolve(defaultValue));
      }
      return new Promise((resolve) => {
        this.resolves[state.id] = resolve;
      });
    });
    this.properties[prop] = promise.id;
    return promise.promise;
  }
  setProp(prop, value) {
    if (this.resolves[this.properties[prop]]) {
      this.resolves[this.properties[prop]](value);
    } else {
      this.prop(prop, value);
    }
  }
  createPromise(promise) {
    const id = this.promises.length;
    const state = new PromiseState(id, promise);
    this.promises.push(state);
    return state;
  }
  async loop(update) {
    await update(this);
    while (true) {
      try {
        await Promise.race(this.promises.map((promise) => promise.promise));
        this.promises.forEach((promise) => {
          if (promise.state === 0 /* Pending */) {
            promise.stored = promise.promise;
            promise.promise = new Promise((resolve) => resolve(promise.data));
          }
        });
        await update(this);
        this.promises.forEach((promise) => {
          promise.promise = promise.stored;
        });
      } catch (error) {
        console.error(error);
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
    console.log("changed", name, newValue);
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
    const itemsUrl = await ctx.prop("items-url", "/items");
    const items = await ctx.fetch(itemsUrl);
    const selected = await ctx.state("/selected", items[0]);
    const dropdown = this.root.getElementById("select");
    const div = this.root.getElementById("div");
    dropdown.innerHTML = items.map((item) => html`
      <option value=${item}>${item}</option>
    `).join();
    dropdown.value = selected;
    div.textContent = selected;
  }
  eventListeners(ctx) {
    const dropdown = this.root.getElementById("select");
    dropdown.addEventListener("change", () => {
      ctx.set("/selected", dropdown.value);
    });
  }
}

class DropdownChanger extends AsyncComponent {
  name = "changer-dropdown";
  static observedAttributes = [];
  template() {
    return html`
      <div>
        <select id="select">
        </select>
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
    dropdown.innerHTML = items.map((item) => html`
      <option value=${item}>${item}</option>
    `).join();
    dropdown.value = selected;
    awaitDropdown.setAttribute("items-url", selected);
  }
  eventListeners(ctx) {
    const dropdown = this.root.getElementById("select");
    dropdown.addEventListener("change", () => {
      ctx.set("/selected", dropdown.value);
    });
  }
}
customElements.define("await-dropdown", Dropdown);
customElements.define("changer-dropdown", DropdownChanger);
