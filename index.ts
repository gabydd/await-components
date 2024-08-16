enum State {
  Fulfilled,
  Pending,
  Rejected,
}

const globalContext = {
  resources: {} as Record<string, number>,
  resolves: {} as Record<number, (value: any) => void>,
  promises: [] as PromiseState<any>[],
}
type Executor<T> = (state: PromiseState<T>) => Promise<T>;

const NOT_INITIALIZED = Symbol("Data not initialized");

class PromiseState<T> {
  data: T | typeof NOT_INITIALIZED = NOT_INITIALIZED;
  initialized = false;
  consumed = false;
  state: State = State.Pending;
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
    try {
      this.data = await this.executor(this);
      this.initialized = true;
      this.state = State.Fulfilled;
      return this.data
    } catch (e) {
      console.log(e)
      this.state = State.Rejected;
      throw e;
    } finally {
    }
  }
}

class Context {
  addListener(element: HTMLElement, event: string, listener: (ctx: Context, e: Event) => Promise<void>) {
    element.addEventListener(event, async (e) => {
      this.promises.forEach((id) => {
        const promise = globalContext.promises[id];
        if (promise.state === State.Pending) {
          promise.stored = promise.promise;
          promise.promise = new Promise((resolve) => resolve(promise.data))
        } else {
          promise.stored = promise.createPromise();
          promise.state = State.Pending;
        }
      });
      await listener(this, e);
      this.promises.forEach((id) => {
        const promise = globalContext.promises[id];
        if (promise.consumed) {
          promise.promise = promise.createPromise();
          promise.stored = promise.promise;
          promise.state = State.Pending;
        } else {
          promise.promise = promise.stored;
        }
      });
    })
  }
  private promises: number[] = [];
  private properties: Record<string, number> = {};
  private states: Record<string, number> = {};
  private initialVals: Record<string, any> = {};
  fetch<T>(resource: string): Promise<T> {
    const id = globalContext.resources[resource];
    if (id !== undefined) {
      const promise = globalContext.promises[globalContext.resources[resource]];
      if (!this.promises.includes(id)) {
        if (promise.state == State.Pending && promise.initialized) {
          promise.stored = promise.promise;
          promise.promise = new Promise(resolve => resolve(promise.data));
        }
        promise.consumed = true;
        this.promises.push(id);
      }
      return promise.promise;
    }
    const promise = this.createPromise<T>((state) => {
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
  state<T>(resource: string, initial: T): Promise<T> {
    if (this.states[resource] !== undefined) {
      if (this.initialVals[resource] !== initial) {
        this.set(resource, initial);
        this.initialVals[resource] = initial;
      }
      const promise = globalContext.promises[this.states[resource]];
      promise.consumed = true;
      return promise.promise;
    }
    this.initialVals[resource] = initial;
    const promise = this.createPromise<T>((state) => {
      if (!state.initialized) {
        return new Promise((resolve) => {
          resolve(initial);
        });
      }
      return new Promise((resolve) => {
        globalContext.resolves[state.id] = resolve;
      })
    })
    this.states[resource] = promise.id;
    promise.consumed = true;
    return promise.promise;
  }
  set<T>(resource: string, value: T) {
    if (this.states[resource]) {
      const promise = globalContext.promises[this.states[resource]];
      if (promise.state === State.Fulfilled) {
        promise.stored = promise.createPromise();
        promise.state = State.Pending;
      }
      promise.consumed = false;
      promise.promise = promise.stored;
      globalContext.resolves[this.states[resource]](value);
    } else {
      this.state(resource, value);
    }
  }
  prop<T>(prop: string, defaultValue: T): Promise<T> {
    if (this.properties[prop] !== undefined) {
      const promise = globalContext.promises[this.properties[prop]];
      promise.consumed = true;
      return promise.promise;
    }
    const promise = this.createPromise<T>((state) => {
      if (!state.initialized) {
        return new Promise((resolve) => resolve(defaultValue));
      }
      return new Promise((resolve) => {
        globalContext.resolves[state.id] = resolve;
      })
    })
    this.properties[prop] = promise.id;
    promise.consumed = true;
    return promise.promise;
  }
  setProp<T>(prop: string, value: T) {
    if (globalContext.resolves[this.properties[prop]]) {
      globalContext.promises[this.properties[prop]].consumed = false;
      globalContext.resolves[this.properties[prop]](value);
    } else {
      this.prop(prop, value);
    }
  }
  getProp<T>(prop: string): T {
    return globalContext.promises[this.properties[prop]].data;
  }
  createPromise<T>(promise: Executor<T>) {
    const id = globalContext.promises.length;
    const state = new PromiseState(id, promise);
    globalContext.promises.push(state);
    this.promises.push(id);
    return state;
  }
  async loop(update: (ctx: Context) => Promise<void>) {
    await update(this);
    this.promises.forEach((id) => {
      const promise = globalContext.promises[id];
      if (promise.consumed) {
        promise.promise = promise.createPromise();
        promise.stored = promise.promise;
        promise.state = State.Pending;
      } else {
        promise.promise = promise.stored;
      }
    });
    while (true) {
      try {
        await Promise.race(this.promises.map(id => globalContext.promises[id].promise));
        this.promises.forEach((id) => {
          const promise = globalContext.promises[id];
          if (promise.state === State.Pending) {
            promise.stored = promise.promise;
            promise.promise = new Promise((resolve) => resolve(promise.data))
          } else {
            promise.stored = promise.createPromise();
            promise.state = State.Pending;
          }
        });
        await update(this);
        this.promises.forEach((id) => {
          const promise = globalContext.promises[id];
          if (promise.consumed) {
            promise.promise = promise.createPromise();
            promise.stored = promise.promise;
            promise.state = State.Pending;
          } else {
            promise.promise = promise.stored;
          }
        });
      }
      catch (error) {
        console.error(error)
        this.promises.forEach((id) => {
          const promise = globalContext.promises[id];
          if (promise.state === State.Rejected) {
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
                  promise.state = State.Fulfilled;
                  resolve(promise.data);
                } catch (e) {
                  console.log(e)
                  promise.state = State.Rejected;
                  reject();
                } finally {
                }
            }, 1000);
            promise.stored = promise.promise;
          } else if (promise.consumed) {
            promise.promise = promise.createPromise();
            promise.stored = promise.promise;
            promise.state = State.Pending;
          } else {
            promise.promise = promise.stored;
          }
        });
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
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    const div = this.root.getElementById("div") as HTMLDivElement;
    dropdown.innerHTML = html`<option>Loading...</option>`;
    div.textContent = "Loading..."
    const itemsUrl = await ctx.prop("items-url", "/items");
    const items = await ctx.fetch<string[]>(itemsUrl);
    const selected = await ctx.state(itemsUrl + "/selected", items[0]);
    dropdown.innerHTML = items.map(item => html`
      <option value=${item}>${item}</option>
    `).join();
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
    `
  }

  async update(ctx: Context) {
    const items = await ctx.fetch<string[]>("/itemUrls");
    const selected = await ctx.state("/selected", items[0]);
    const dropdown = this.root.getElementById("select") as HTMLSelectElement;
    const awaitDropdown = this.root.getElementById("await-dropdown")!;
    const div = this.root.getElementById("div") as HTMLDivElement;
    let test = await ctx.state("/testing", 1);
    if (test !== 3) {
      ctx.set("/testing", 3);
    }
    dropdown.innerHTML = items.map(item => html`
      <option value=${item}>${item}</option>
    `).join();
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
  template() {
    return html`
      <div id="div"></div>
    `
  }

  async update(ctx: Context) {
    const div = this.root.getElementById("div") as HTMLDivElement;
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
