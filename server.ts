import type { ServerWebSocket } from "bun";
import { MessageType, type ClientMessage, type ServerMessage, type Todo } from "./shared"

const todos: Map<number, Todo> = new Map();
const users = new Set<number>();
let nextTodoId = 0;
let nextUserId = 0;

function todoId() {
  return nextTodoId++;
}

function userId() {
  return nextUserId++;
}

function createTodo(ws: ServerWebSocket<number>, text: string) {
  const id = todoId();
  todos.set(id, { text, done: false, id });
  server.publish("/todos", JSON.stringify({ path: "/todos", data: [...todos.keys()] } satisfies ServerMessage));
}

function removeTodo(ws: ServerWebSocket<number>, id: number) {
  todos.delete(id);
  server.publish("/todos", JSON.stringify({ path: "/todos", data: [...todos.keys()] } satisfies ServerMessage));
}

function updateTodo(ws: ServerWebSocket<number>, todo: Todo) {
  todos.set(todo.id, todo);
  server.publish(`/todo/${todo.id}`, JSON.stringify({ path: `/todo/${todo.id}`, data: todo } satisfies ServerMessage));
}

const server = Bun.serve<number>({
  async fetch(request) {
    let path = new URL(request.url).pathname;
    console.log(path);
    if (path === "/wss") {
      const id = userId();
      const success = server.upgrade(request, { data: id });
      if (success) {
        users.add(id);
        return undefined;
      } else {
        return new Response("Upgrade failed", { status: 400 });
      }
    }
    if (path === "/items") {
      await Bun.sleep(1000);
      console.log("items");
      return Response.json(["test", "test2"]);
    }
    if (path === "/items2") return Response.json(["test3", "test4"]);
    if (path === "/items3") {
      await Bun.sleep(5000);
      return Response.json(["test", "test2", "test3", "test4"]);
    }
    if (path === "/itemUrls") return Response.json(["/items", "/items2", "/items3"]);
    const sep = path.lastIndexOf(".");
    const slash = path.lastIndexOf("/");
    if (sep === -1 || slash > sep) {
      if (path.at(-1) === "/") {
        path += "index.html";
      } else {
        path += ".html"
      }
    }
    const file = Bun.file("./serve" + path);
    return new Response(file);
  },
  websocket: {
    message(ws, message) {
      console.log(todos);
      if (typeof message === "string") {
        const data: ClientMessage = JSON.parse(message);
        console.log(data);
        switch (data.type) {
          case MessageType.CreateTodo: {
            createTodo(ws, data.text);
            break;
          }
          case MessageType.RemoveTodo: {
            removeTodo(ws, data.id);
            break;
          }
          case MessageType.UpdateTodo: {
            updateTodo(ws, data.todo);
            break;
          }
          case MessageType.Subscribe: {
            if (data.path === "/todos") {
              ws.send(JSON.stringify({ path: "/todos", data: [...todos.keys()] } satisfies ServerMessage))
            } else {
              const id = Number.parseInt(data.path.slice(data.path.lastIndexOf("/") + 1));
              ws.send(JSON.stringify({ path: data.path, data: todos.get(id) }))
            }
            ws.subscribe(data.path);
            break;
          }
        }
      }
    },
    close(ws, code, reason) {
      users.delete(ws.data);
    },
    open(ws) {
    },
  }
})

console.log(server.port);
