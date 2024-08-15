enum State {
  Pending,
  Fulfilled,
  Rejected,
}
type Executor<T> = (state: PromiseState<T>) => Promise<T>;

const NOT_INITIALIZED = Symbol("Data not initialized");

class PromiseState<T> {
  data: T | typeof NOT_INITIALIZED = NOT_INITIALIZED;
  initialized = false;
  state: State = State.Pending;
  promise: Promise<T>;
  stored: Promise<T>;
  executor: Executor<T>
  id: number;
  constructor(id: number, executor: Executor<T>) {
    this.id = id;
    this.executor = executor;
    this.promise = this.createPromise();
    this.stored = this.promise;
  }

  createPromise() {
    return new Promise<T>(async (resolve, reject) => {
      try {
        this.data = await this.executor(this);
        this.initialized = true;
        this.state = State.Fulfilled;
        resolve(this.data);
      } catch (e) {
        this.state = State.Rejected;
        console.log(e)
        reject();
      } finally {
        this.promise = this.createPromise();
        this.stored = this.promise;
        this.state = State.Pending;
      }
    })
  }
}

class Context {
  private promises: PromiseState<any>[] = [];
  private resources: Record<string, number> = {};
  private properties: Record<string, number> = {};
  private resolves: Record<number, (value: any) => void> = {};
  private initialVals: Record<string, any> = {};
  fetch<T>(resource: string): Promise<T> {
    if (this.resources[resource] !== undefined) {
      return this.promises[this.resources[resource]].promise;
    }
    const promise = this.createPromise<T>((state) => {
      if (!state.initialized) {
        return new Promise(async (resolve, reject) => {
          const res = await fetch(resource);
          resolve(await res.json());
        })
      }
      return new Promise(() => { });
    });
    this.resources[resource] = promise.id;
    return promise.promise;
  }
  state<T>(resource: string, initial: T): Promise<T> {
    if (this.resources[resource] !== undefined) {
      if (this.initialVals[resource] !== initial) {
        this.set(resource, initial);
        this.initialVals[resource] = initial;
      }
      return this.promises[this.resources[resource]].promise;
    }
    this.initialVals[resource] = initial;
    const promise = this.createPromise<T>((state) => {
      if (!state.initialized) {
        return new Promise((resolve) => resolve(initial));
      }
      return new Promise((resolve) => {
        this.resolves[state.id] = resolve;
      })
    })
    this.resources[resource] = promise.id;
    return promise.promise;
  }
  set<T>(resource: string, value: T) {
    if (this.resolves[this.resources[resource]]) {
      const promise = this.promises[this.resources[resource]];
      promise.promise = promise.stored;
      this.resolves[this.resources[resource]](value);
    } else {
      this.state(resource, value);
    }
  }
  prop<T>(prop: string, defaultValue: T): Promise<T> {
    if (this.properties[prop] !== undefined) {
      return this.promises[this.properties[prop]].promise;
    }
    const promise = this.createPromise<T>((state) => {
      if (!state.initialized) {
        return new Promise((resolve) => resolve(defaultValue));
      }
      return new Promise((resolve) => {
        this.resolves[state.id] = resolve;
      })
    })
    this.properties[prop] = promise.id;
    return promise.promise;
  }
  setProp<T>(prop: string, value: T) {
    if (this.resolves[this.properties[prop]]) {
      this.resolves[this.properties[prop]](value);
    } else {
      this.prop(prop, value);
    }
  }
  createPromise<T>(promise: Executor<T>) {
    const id = this.promises.length;
    const state = new PromiseState(id, promise);
    this.promises.push(state);
    return state;
  }
  async loop(update: (ctx: Context) => Promise<void>) {
    await update(this);
    while (true) {
      try {
        await Promise.race(this.promises.map(promise => promise.promise));
        this.promises.forEach((promise) => {
          if (promise.state === State.Pending) {
            promise.stored = promise.promise;
            promise.promise = new Promise((resolve) => resolve(promise.data))
          }
        });
        await update(this);
        this.promises.forEach((promise) => {
            promise.promise = promise.stored;
        });
      }
      catch (error) {
        console.error(error)
      }
    }
  }
}

class AsyncComponent extends HTMLElement {
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
      const temp = document.createElement("template");
      temp.innerHTML = this.template();
      temp.id = this.name + "-template";
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
    this.eventListeners(this.context);
    this.context.loop(this.update.bind(this));
  }
  disconnectedCallback() {

  }
  adoptedCallback() {

  }
  attributeChangedCallback(name: string, oldValue: any, newValue: any) {
    console.log("changed", name, newValue);
    this.context.setProp(name, newValue);
  }
  template(): string {
    throw new Error("Must implement template");
  }
  async update(ctx: Context): Promise<void> {
    throw new Error("Must implement update");
  }
  eventListeners(ctx: Context) {
  }
}

const html = (strings: any, ...values: any[]) => String.raw({ raw: strings }, ...values);
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
    `
  }

  async update(ctx: Context) {
    const itemsUrl = await ctx.prop("items-url", "/items");
    const items = await ctx.fetch<string[]>(itemsUrl);
    const selected = await ctx.state("/selected", items[0]);
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    const div = this.root.getElementById("div") as HTMLDivElement;
    dropdown.innerHTML = items.map(item => html`
      <option value=${item}>${item}</option>
    `).join();
    dropdown.value = selected;
    div.textContent = selected;
  }

  eventListeners(ctx: Context) {
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    dropdown.addEventListener("change", () => {
      ctx.set("/selected", dropdown.value);
    })
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
    `
  }

  async update(ctx: Context) {
    const items = await ctx.fetch<string[]>("/itemUrls");
    const selected = await ctx.state("/selected", items[0]);
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    const awaitDropdown = this.root.getElementById("await-dropdown")!;
    dropdown.innerHTML = items.map(item => html`
      <option value=${item}>${item}</option>
    `).join();
    dropdown.value = selected;
    awaitDropdown.setAttribute("items-url", selected);
  }

  eventListeners(ctx: Context) {
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    dropdown.addEventListener("change", () => {
      ctx.set("/selected", dropdown.value);
    })
  }
}

customElements.define("await-dropdown", Dropdown);
customElements.define("changer-dropdown", DropdownChanger);
