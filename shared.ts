export type Todo = {
  text: string;
  done: boolean;
  id: number;
}

export enum MessageType {
  CreateTodo,
  RemoveTodo,
  UpdateTodo,
  SubscribeTodo,
  SubscribeTodos,
}

export enum ServerMessageType {
  UpdateTodo,
  UpdateTodos,
}

export type ClientMessage = { type: MessageType.CreateTodo, text: string } | { type: MessageType.RemoveTodo, id: number } | { type: MessageType.UpdateTodo, todo: Todo } | { type: MessageType.SubscribeTodo, id: number } | { type: MessageType.SubscribeTodos };

export type ServerMessage = {type: ServerMessageType.UpdateTodo, data: Todo} | {type: ServerMessageType.UpdateTodos, data: number[]};
