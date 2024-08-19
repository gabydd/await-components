export type Todo = {
  text: string;
  done: boolean;
  id: number;
}

export enum MessageType {
  CreateTodo,
  RemoveTodo,
  UpdateTodo,
  Subscribe,
}

export type Subscriptions = {
  "/todos": number[];
  [K: `/todo/${string}`]: Todo;
}

export type ClientMessage = { type: MessageType.CreateTodo, text: string } | { type: MessageType.RemoveTodo, id: number } | { type: MessageType.UpdateTodo, todo: Todo } | { type: MessageType.Subscribe, path: keyof Subscriptions };

export type ServerMessage = {[K in keyof Subscriptions]: {
  path: K,
  data: Subscriptions[K];
}}[keyof Subscriptions]
