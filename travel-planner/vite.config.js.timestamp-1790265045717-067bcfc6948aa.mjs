// vite.config.js
import { defineConfig, loadEnv } from "file:///C:/Users/mahij/Downloads/AI%20PROJECTS%202026/Wanderful/travel-planner/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/mahij/Downloads/AI%20PROJECTS%202026/Wanderful/travel-planner/node_modules/@vitejs/plugin-react/dist/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
var __spreadArray = function(to, from, pack) {
  if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
    if (ar || !(i in from)) {
      if (!ar) ar = Array.prototype.slice.call(from, 0, i);
      ar[i] = from[i];
    }
  }
  return to.concat(ar || Array.prototype.slice.call(from));
};
var vite_config_default = defineConfig(function(_a) {
  var mode = _a.mode;
  var env = loadEnv(mode, process.cwd(), "");
  var apiTarget = env.VITE_API_TARGET || "http://127.0.0.1:5052";
  return {
    plugins: [react(), {
      name: "versioned-offline-shell",
      writeBundle: function(options, bundle) {
        var assets = __spreadArray(["/index.html", "/manifest.webmanifest"], Object.keys(bundle).filter(function(name) {
          return /\.(js|css|woff2?)$/.test(name);
        }).map(function(name) {
          return "/".concat(name);
        }), true);
        var version = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 16);
        var source = readFileSync(resolve("public/sw.js"), "utf8").replace("/* BUILD_ASSETS */ []", JSON.stringify(assets)).replace("development", version);
        writeFileSync(resolve(options.dir || "dist", "sw.js"), source);
      }
    }],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true
        }
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: function(id) {
            if (!id.includes("node_modules"))
              return void 0;
            if (id.includes("react-leaflet") || id.includes("/leaflet/"))
              return "maps";
            if (id.includes("/gsap/"))
              return "animation";
            if (id.includes("react-markdown") || id.includes("remark-"))
              return "markdown";
            return void 0;
          }
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxtYWhpalxcXFxEb3dubG9hZHNcXFxcQUkgUFJPSkVDVFMgMjAyNlxcXFxXYW5kZXJmdWxcXFxcdHJhdmVsLXBsYW5uZXJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXG1haGlqXFxcXERvd25sb2Fkc1xcXFxBSSBQUk9KRUNUUyAyMDI2XFxcXFdhbmRlcmZ1bFxcXFx0cmF2ZWwtcGxhbm5lclxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvbWFoaWovRG93bmxvYWRzL0FJJTIwUFJPSkVDVFMlMjAyMDI2L1dhbmRlcmZ1bC90cmF2ZWwtcGxhbm5lci92aXRlLmNvbmZpZy5qc1wiO3ZhciBfX3NwcmVhZEFycmF5ID0gKHRoaXMgJiYgdGhpcy5fX3NwcmVhZEFycmF5KSB8fCBmdW5jdGlvbiAodG8sIGZyb20sIHBhY2spIHtcbiAgICBpZiAocGFjayB8fCBhcmd1bWVudHMubGVuZ3RoID09PSAyKSBmb3IgKHZhciBpID0gMCwgbCA9IGZyb20ubGVuZ3RoLCBhcjsgaSA8IGw7IGkrKykge1xuICAgICAgICBpZiAoYXIgfHwgIShpIGluIGZyb20pKSB7XG4gICAgICAgICAgICBpZiAoIWFyKSBhciA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGZyb20sIDAsIGkpO1xuICAgICAgICAgICAgYXJbaV0gPSBmcm9tW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0by5jb25jYXQoYXIgfHwgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoZnJvbSkpO1xufTtcbmltcG9ydCB7IGRlZmluZUNvbmZpZywgbG9hZEVudiB9IGZyb20gXCJ2aXRlXCI7XG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwibm9kZTpjcnlwdG9cIjtcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyhmdW5jdGlvbiAoX2EpIHtcbiAgICB2YXIgbW9kZSA9IF9hLm1vZGU7XG4gICAgdmFyIGVudiA9IGxvYWRFbnYobW9kZSwgcHJvY2Vzcy5jd2QoKSwgXCJcIik7XG4gICAgdmFyIGFwaVRhcmdldCA9IGVudi5WSVRFX0FQSV9UQVJHRVQgfHwgXCJodHRwOi8vMTI3LjAuMC4xOjUwNTJcIjtcbiAgICByZXR1cm4ge1xuICAgICAgICBwbHVnaW5zOiBbcmVhY3QoKSwge1xuICAgICAgICAgICAgICAgIG5hbWU6IFwidmVyc2lvbmVkLW9mZmxpbmUtc2hlbGxcIixcbiAgICAgICAgICAgICAgICB3cml0ZUJ1bmRsZTogZnVuY3Rpb24gKG9wdGlvbnMsIGJ1bmRsZSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgYXNzZXRzID0gX19zcHJlYWRBcnJheShbXCIvaW5kZXguaHRtbFwiLCBcIi9tYW5pZmVzdC53ZWJtYW5pZmVzdFwiXSwgT2JqZWN0LmtleXMoYnVuZGxlKS5maWx0ZXIoZnVuY3Rpb24gKG5hbWUpIHsgcmV0dXJuIC9cXC4oanN8Y3NzfHdvZmYyPykkLy50ZXN0KG5hbWUpOyB9KS5tYXAoZnVuY3Rpb24gKG5hbWUpIHsgcmV0dXJuIFwiL1wiLmNvbmNhdChuYW1lKTsgfSksIHRydWUpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgdmVyc2lvbiA9IGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKEpTT04uc3RyaW5naWZ5KGFzc2V0cykpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNik7XG4gICAgICAgICAgICAgICAgICAgIHZhciBzb3VyY2UgPSByZWFkRmlsZVN5bmMocmVzb2x2ZShcInB1YmxpYy9zdy5qc1wiKSwgXCJ1dGY4XCIpLnJlcGxhY2UoJy8qIEJVSUxEX0FTU0VUUyAqLyBbXScsIEpTT04uc3RyaW5naWZ5KGFzc2V0cykpLnJlcGxhY2UoXCJkZXZlbG9wbWVudFwiLCB2ZXJzaW9uKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGVGaWxlU3luYyhyZXNvbHZlKG9wdGlvbnMuZGlyIHx8IFwiZGlzdFwiLCBcInN3LmpzXCIpLCBzb3VyY2UpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9XSxcbiAgICAgICAgc2VydmVyOiB7XG4gICAgICAgICAgICBob3N0OiBcIjEyNy4wLjAuMVwiLFxuICAgICAgICAgICAgcG9ydDogNTE3MyxcbiAgICAgICAgICAgIHByb3h5OiB7XG4gICAgICAgICAgICAgICAgXCIvYXBpXCI6IHtcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiBhcGlUYXJnZXQsXG4gICAgICAgICAgICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IHtcbiAgICAgICAgICAgICAgICAgICAgbWFudWFsQ2h1bmtzOiBmdW5jdGlvbiAoaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghaWQuaW5jbHVkZXMoXCJub2RlX21vZHVsZXNcIikpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcyhcInJlYWN0LWxlYWZsZXRcIikgfHwgaWQuaW5jbHVkZXMoXCIvbGVhZmxldC9cIikpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwibWFwc1wiO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKFwiL2dzYXAvXCIpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBcImFuaW1hdGlvblwiO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKFwicmVhY3QtbWFya2Rvd25cIikgfHwgaWQuaW5jbHVkZXMoXCJyZW1hcmstXCIpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBcIm1hcmtkb3duXCI7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgIH07XG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFTQSxTQUFTLGNBQWMsZUFBZTtBQUN0QyxPQUFPLFdBQVc7QUFDbEIsU0FBUyxjQUFjLHFCQUFxQjtBQUM1QyxTQUFTLGVBQWU7QUFDeEIsU0FBUyxrQkFBa0I7QUFiK1csSUFBSSxnQkFBZ0QsU0FBVSxJQUFJLE1BQU0sTUFBTTtBQUNwZCxNQUFJLFFBQVEsVUFBVSxXQUFXLEVBQUcsVUFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLFFBQVEsSUFBSSxJQUFJLEdBQUcsS0FBSztBQUNqRixRQUFJLE1BQU0sRUFBRSxLQUFLLE9BQU87QUFDcEIsVUFBSSxDQUFDLEdBQUksTUFBSyxNQUFNLFVBQVUsTUFBTSxLQUFLLE1BQU0sR0FBRyxDQUFDO0FBQ25ELFNBQUcsQ0FBQyxJQUFJLEtBQUssQ0FBQztBQUFBLElBQ2xCO0FBQUEsRUFDSjtBQUNBLFNBQU8sR0FBRyxPQUFPLE1BQU0sTUFBTSxVQUFVLE1BQU0sS0FBSyxJQUFJLENBQUM7QUFDM0Q7QUFNQSxJQUFPLHNCQUFRLGFBQWEsU0FBVSxJQUFJO0FBQ3RDLE1BQUksT0FBTyxHQUFHO0FBQ2QsTUFBSSxNQUFNLFFBQVEsTUFBTSxRQUFRLElBQUksR0FBRyxFQUFFO0FBQ3pDLE1BQUksWUFBWSxJQUFJLG1CQUFtQjtBQUN2QyxTQUFPO0FBQUEsSUFDSCxTQUFTLENBQUMsTUFBTSxHQUFHO0FBQUEsTUFDWCxNQUFNO0FBQUEsTUFDTixhQUFhLFNBQVUsU0FBUyxRQUFRO0FBQ3BDLFlBQUksU0FBUyxjQUFjLENBQUMsZUFBZSx1QkFBdUIsR0FBRyxPQUFPLEtBQUssTUFBTSxFQUFFLE9BQU8sU0FBVSxNQUFNO0FBQUUsaUJBQU8scUJBQXFCLEtBQUssSUFBSTtBQUFBLFFBQUcsQ0FBQyxFQUFFLElBQUksU0FBVSxNQUFNO0FBQUUsaUJBQU8sSUFBSSxPQUFPLElBQUk7QUFBQSxRQUFHLENBQUMsR0FBRyxJQUFJO0FBQ3BOLFlBQUksVUFBVSxXQUFXLFFBQVEsRUFBRSxPQUFPLEtBQUssVUFBVSxNQUFNLENBQUMsRUFBRSxPQUFPLEtBQUssRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUMzRixZQUFJLFNBQVMsYUFBYSxRQUFRLGNBQWMsR0FBRyxNQUFNLEVBQUUsUUFBUSx5QkFBeUIsS0FBSyxVQUFVLE1BQU0sQ0FBQyxFQUFFLFFBQVEsZUFBZSxPQUFPO0FBQ2xKLHNCQUFjLFFBQVEsUUFBUSxPQUFPLFFBQVEsT0FBTyxHQUFHLE1BQU07QUFBQSxNQUNqRTtBQUFBLElBQ0osQ0FBQztBQUFBLElBQ0wsUUFBUTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sT0FBTztBQUFBLFFBQ0gsUUFBUTtBQUFBLFVBQ0osUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFFBQ2xCO0FBQUEsTUFDSjtBQUFBLElBQ0o7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNILGVBQWU7QUFBQSxRQUNYLFFBQVE7QUFBQSxVQUNKLGNBQWMsU0FBVSxJQUFJO0FBQ3hCLGdCQUFJLENBQUMsR0FBRyxTQUFTLGNBQWM7QUFDM0IscUJBQU87QUFDWCxnQkFBSSxHQUFHLFNBQVMsZUFBZSxLQUFLLEdBQUcsU0FBUyxXQUFXO0FBQ3ZELHFCQUFPO0FBQ1gsZ0JBQUksR0FBRyxTQUFTLFFBQVE7QUFDcEIscUJBQU87QUFDWCxnQkFBSSxHQUFHLFNBQVMsZ0JBQWdCLEtBQUssR0FBRyxTQUFTLFNBQVM7QUFDdEQscUJBQU87QUFDWCxtQkFBTztBQUFBLFVBQ1g7QUFBQSxRQUNKO0FBQUEsTUFDSjtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQ0osQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
