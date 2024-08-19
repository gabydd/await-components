import { AsyncComponent, Context, type CreateElement } from "./index";
import { type Todo, MessageType, type ClientMessage } from "./shared";

class Layout extends AsyncComponent {
  name = "todos-layout";
  template(ctx: Context, h: CreateElement) {
    return h("div", {},
      h("div", {}, h("input", { type: "text", id: "text" }), h("button", { id: "create" }, "Create Todo")),
      h("div", { id: "list" }))
  }
  todoChildren = new Map<number, TodoItem>();
  async update(ctx: Context, h: CreateElement) {
    const list = this.root.getElementById("list") as HTMLDivElement;
    const ws = await ctx.ws("/wss");
    const todos = await ws.subscribe("/todos");
    const toAdd = new Set<number>(todos);
    for (const todo of this.todoChildren.keys()) {
      if (!toAdd.has(todo)) {
        this.todoChildren.get(todo)!.remove();
        this.todoChildren.delete(todo);
      } else {
        toAdd.delete(todo);
      }
    }
    for (const todo of toAdd.keys()) {
      this.todoChildren.set(todo, list.appendChild(h("todo-item", { "todo-id": todo })));
    }
  }
  eventListeners(ctx: Context, h: CreateElement) {
    const text = this.root.getElementById("text") as HTMLInputElement;
    const create = this.root.getElementById("create") as HTMLButtonElement;
    ctx.addListener(create, "click", async (ctx) => {
      const ws = await ctx.ws("/wss");
      ws.send({ type: MessageType.CreateTodo, text: text.value } satisfies ClientMessage)
    });
  }
}

class TodoItem extends AsyncComponent {
  name = "todo-item";
  static observedAttributes = ["todo-id"];
  template(ctx: Context, h: CreateElement) {
    return h("div", {},
      h("input", { id: "done", type: "checkbox" }),
      h("span", { id: "text" }),
      h("button", { id: "delete" }, "Delete"))
  }
  async update(ctx: Context, h: CreateElement) {
    const done = this.root.getElementById("done") as HTMLInputElement;
    const text = this.root.getElementById("text") as HTMLSpanElement;
    const ws = await ctx.ws("/wss");
    const todoId = await ctx.prop("todo-id", "0");
    const todo = await ws.subscribe(`/todo/${todoId}`);
    done.checked = todo.done;
    text.textContent = todo.text;
  }
  eventListeners(ctx: Context, h: CreateElement) {
    const done = this.root.getElementById("done") as HTMLInputElement;
    const deleteTodo = this.root.getElementById("delete") as HTMLButtonElement;
    ctx.addListener(done, "change", async (ctx) => {
      const ws = await ctx.ws("/wss");
      const todoId = await ctx.prop("todo-id", "0");
      const todo = await ws.subscribe(`/todo/${todoId}`);
      todo.done = done.checked;
      ws.send({ type: MessageType.UpdateTodo, todo } satisfies ClientMessage)
    })
    ctx.addListener(deleteTodo, "click", async (ctx) => {
      const ws = await ctx.ws("/wss");
      const todoId = await ctx.prop("todo-id", "0");
      ws.send({ type: MessageType.RemoveTodo, id: Number.parseInt(todoId) } satisfies ClientMessage)
    })
  }
}

customElements.define("todos-layout", Layout);
customElements.define("todo-item", TodoItem);

declare global {
  interface HTMLElementTagNameMap {
    "todos-layout": Layout;
    "todo-item": TodoItem;
  }
}
