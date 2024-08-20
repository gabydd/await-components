import { AsyncComponent, Context, type CreateElement } from "./index";
import { MessageType, type ClientMessage } from "./shared";

class Layout extends AsyncComponent {
  name = "todos-layout";
  render(ctx: Context, h: CreateElement) {
    return h("div", {},
      h("div", {}, h("input", { type: "text", id: "text" }), h("button", {
        onClick: async (ctx: Context, ev: any) => {
          const ws = await ctx.ws("/wss");
          ws.send({ type: MessageType.CreateTodo, text: ev.target.parentElement.firstElementChild.value } satisfies ClientMessage)
        }
      }, "Create Todo")),
      h("div", { id: "list" },
        async (ctx: Context) => {
          const ws = await ctx.ws("/wss");
          const todos = await ws.subscribe("/todos");
          return todos.map(todo => h("todo-item", { key: todo, "todo-id": todo }))
        }
      ))
  }
}

class TodoItem extends AsyncComponent {
  name = "todo-item";
  static observedAttributes = ["todo-id"];
  render(ctx: Context, h: CreateElement) {
    const todo = ctx.create(async (ctx: Context) => {
      const ws = await ctx.ws("/wss");
      const todoId = await ctx.prop("todo-id", "0");
      return ws.subscribe(`/todo/${todoId}`);
    });
    return h("div", {},
      h("input", {
        type: "checkbox", onChange: async (ctx: Context, ev: any) => {
          const ws = await ctx.ws("/wss");
          const todoId = await ctx.prop("todo-id", "0");
          const todo = await ws.subscribe(`/todo/${todoId}`);
          todo.done = ev.target.checked;
          ws.send({ type: MessageType.UpdateTodo, todo } satisfies ClientMessage)
        }, checked: async (ctx: Context) => (await todo(ctx)).done
      }),
      h("span", {}, async (ctx: Context) => (await todo(ctx)).text),
      h("button", {
        onClick: async (ctx: Context) => {
          const ws = await ctx.ws("/wss");
          const todoId = await ctx.prop("todo-id", "0");
          ws.send({ type: MessageType.RemoveTodo, id: Number.parseInt(todoId) } satisfies ClientMessage)
        }
      }, "Delete"))
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
