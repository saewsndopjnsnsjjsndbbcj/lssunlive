var dbUrl = "https://bcrapi-default-rtdb.firebaseio.com/
";

(function () {
  var OriginalWebSocket = window.WebSocket;

  // Auto clear console mỗi 30s
  setInterval(() => {
    console.clear();
    console.log("🧹 Console đã được dọn tự động sau 30s");
  }, 30000);

  window.WebSocket = function (url, protocols) {
    var ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

    ws.addEventListener("message", async function (event) {
      try {
        var text;

        // Giải mã dữ liệu nhận từ WebSocket
        if (event.data instanceof ArrayBuffer) {
          text = new TextDecoder("utf-8").decode(event.data);
        } else if (typeof event.data === "string") {
          text = event.data;
        } else {
          return;
        }

        // Lọc dữ liệu game start / end
        if (text.includes("mnmdsbgamestart") || text.includes("mnmdsbgameend")) {
          var dicesMatch = text.match(/\{(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\}/);
          if (!dicesMatch) return;

          var dice1 = parseInt(dicesMatch[1], 10);
          var dice2 = parseInt(dicesMatch[2], 10);
          var dice3 = parseInt(dicesMatch[3], 10);

          if (isNaN(dice1) || isNaN(dice2) || isNaN(dice3)) return;

          var total = dice1 + dice2 + dice3;
          var result = total > 10 ? "Tài" : "Xỉu";

          var sessionMatch = text.match(/#(\d+)[_\-]/);
          var sessionNumber = sessionMatch ? parseInt(sessionMatch[1], 10) : null;
          if (!sessionNumber) return;

          var payload = {
            "Phien": sessionNumber,
            "xuc_xac_1": dice1,
            "xuc_xac_2": dice2,
            "xuc_xac_3": dice3,
            "tong": total,
            "ket_qua": result
          };

          console.log("📥 Ghi đè dữ liệu:", payload);

          try {
            // Ghi đè toàn bộ file taixiu_sessions.json
            let res = await fetch(`${dbUrl}/taixiu_sessions.json`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            if (res.ok) {
              console.log("✅ Đã ghi đè dữ liệu vào taixiu_sessions.json");

              // Hiển thị trên giao diện chính
              let container = document.getElementById("taixiu-result");
              if (!container) {
                container = document.createElement("div");
                container.id = "taixiu-result";
                container.style.position = "fixed";
                container.style.top = "10px";
                container.style.right = "10px";
                container.style.padding = "12px";
                container.style.background = "rgba(0,0,0,0.85)";
                container.style.color = "#0f0";
                container.style.fontSize = "14px";
                container.style.fontFamily = "monospace";
                container.style.borderRadius = "8px";
                container.style.zIndex = "99999";
                container.style.minWidth = "180px";
                document.body.appendChild(container);
              }
              container.innerHTML = `
                <b>Phiên #${payload.Phien}</b><br>
                🎲 ${payload.xuc_xac_1} - ${payload.xuc_xac_2} - ${payload.xuc_xac_3}<br>
                ➕ Tổng: ${payload.tong}<br>
                ✅ Kết quả: <b>${payload.ket_qua}</b>
              `;
            } else {
              console.error("❌ Lỗi ghi đè:", res.status);
            }
          } catch (err) {
            console.error("❌ Lỗi fetch lưu phiên:", err);
          }
        }
      } catch (err) {
        console.error("❌ Lỗi khi xử lý WebSocket:", err);
      }
    });

    return ws;
  };

  window.WebSocket.prototype = OriginalWebSocket.prototype;
})();
