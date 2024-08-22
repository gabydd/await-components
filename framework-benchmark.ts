import { AsyncComponent, Context, globalCtx, State, type CreateElement } from "./index";

const adjectives = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"];
const colors = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const nouns = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"];

class Button extends AsyncComponent {
  name = "button-component";
  useShadow = false;
  onClick = (ctx: Context) => { };
  render(ctx: Context, h: CreateElement) {
    return h("button", { type: "button", id: async (ctx: Context) => ctx.prop("id"), onClick: this.onClick, class: "btn btn-primary btn-block" }, h("slot"))
  }
}
function random(max: number) {
  return Math.round(Math.random() * 1000) % max;
}
type RowData = {
  text: State<string>;
  id: State<number>;
};
let nextId = 1;
function buildData(ctx: Context, count: number) {

  const data = new Array<RowData>(count);
  for (let i = 0; i < count; i++) {
    data[i] = { text: ctx.global(`${adjectives[random(adjectives.length)]} ${colors[random(colors.length)]} ${nouns[random(nouns.length)]}`), id: ctx.global(nextId++) };
  }
  return data;
}



const rows = globalCtx.global<RowData[]>([]);
const selected = globalCtx.global(0);
class Layout extends AsyncComponent {
  useShadow = false;
  row(ctx: Context, h: CreateElement, row: RowData) {
    const text = ctx.create(async (ctx) => {
      return await row.text.promise(ctx);
    });
    const rowId = ctx.create(async (ctx) => {
      return await row.id.promise(ctx);
    });
    return h("tr", { class: async (ctx: Context) => await selected.promise(ctx) === await rowId(ctx) ? "danger" : "", key: row.id.get() },
      h("td", { class: "col-md-1" }, rowId),
      h("td", { class: "col-md-1" },
        h("a", { onClick: () => selected.set(row.id.get()) }, text)),
      h("td", { class: "col-md-1" },
        h("a", { onClick: () => rows.set(rows.get().toSpliced(rows.get().findIndex((check) => row.id.get() === check.id.get()), 1)) },
          h("span", { class: "glyphicon glyphicon-remove", "aria-hidden": "true" }))),
    );
  }
  render(ctx: Context, h: CreateElement) {
    return h("div", { class: "container" },
      h("div", { class: "jumbotron" },
        h("div", { class: "row" },
          h("div", { class: "col-md-6" }, h("h1", {}, "")),
          h("div", { class: "col-md-6" },
            h("div", { class: "row" },
              h("action-button", { id: "run", onClick: async (ctx: Context) => { rows.set(buildData(ctx, 1000)) } }, "Create 1,000 rows"),
              h("action-button", { id: "runlots", onClick: async (ctx: Context) => { rows.set(buildData(ctx, 10000)) } }, "Create 10,000 rows"),
              h("action-button", { id: "add", onClick: async (ctx: Context) => { rows.set([...rows.get(), ...buildData(ctx, 1000)]) } }, "Append 1,000 rows"),
              h("action-button", {
                id: "update", onClick: async (ctx: Context) => {
                  const data = rows.get();
                  for (let i = 0, len = rows.get().length; i < len; i += 10) {
                    data[i].text.set(data[i].text.get() + " !!!");
                  }
                }
              }, "Update every 10th row"),
              h("action-button", { id: "clear", onClick: async (ctx: Context) => { rows.set([]) } }, "Clear"),
              h("action-button", {
                id: "swaprows", onClick: async (ctx: Context) => {
                  const data = rows.get();
                  if (data.length > 998) {
                    const storedText = data[1].text.get();
                    const storedId = data[1].id.get();
                    data[1].text.set(data[998].text.get());
                    data[1].id.set(data[998].id.get());
                    data[998].text.set(storedText);
                    data[998].id.set(storedId);
                  }
                }
              }, "Swap"),
            )))),
      h("table", { class: "table table-hover table-striped test-data" },
        h("tbody", {}, async (ctx: Context) => {
          return (await rows.promise(ctx)).map((row) => this.row(ctx, h, row));
        })),
    );
  }
}

class Row extends AsyncComponent {
  name = "bench-row";
  text = undefined;
  rowId = undefined;
  useShadow = false;
  render(ctx: Context, h: CreateElement) {
    const text = ctx.create(async (ctx) => {
      return await this.text.promise(ctx);
    });
    const rowId = ctx.create(async (ctx) => {
      return await this.rowId.promise(ctx);
    });
    return h("tr", { class: async (ctx: Context) => await selected.promise(ctx) === await rowId(ctx) ? "danger" : "" },
      h("td", { class: "col-md-1" }, rowId),
      h("td", { class: "col-md-1" },
        h("a", { onClick: () => selected.set(this.rowId.get()) }, text)),
      h("td", { class: "col-md-1" },
        h("a", { onClick: () => rows.set(rows.get().toSpliced(rows.get().findIndex((row) => row.id.get() === this.rowId.get()), 1)) },
          h("span", { class: "glyphicon glyphicon-remove", "aria-hidden": "true" }))),
    );
  }
}


customElements.define("action-button", Button);
customElements.define("bench-layout", Layout);
customElements.define("bench-row", Row);
declare global {
  interface HTMLElementTagNameMap {
    "action-button": Button;
    "bench-layout": Layout;
    "bench-row": Row;
  }
}
