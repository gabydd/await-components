const server = Bun.serve({
  async fetch(request) {
    let path = new URL(request.url).pathname;
    if (path === "/items") {
      await Bun.sleep(1000);
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
    console.log(path);
    const file = Bun.file("./serve" + path);
    return new Response(file);
  },
})

console.log(server.port);
