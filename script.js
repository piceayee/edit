	
		
window.onload = function () {
    console.log("🔵 頁面載入完成，初始化地圖...");

    const fileInput = document.getElementById("fileInput");
    const clearMarkersBtn = document.getElementById("clearMarkers");
    const photoList = document.getElementById("photoList");

    if (!fileInput || !clearMarkersBtn || !photoList) {
        console.error("❌ 找不到某些 HTML 元素，請檢查 HTML！");
        return;
    }

    let map = L.map("map").setView([25.0330, 121.5654], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    loadMarkersFromGitHub();

    let db;
    let request = indexedDB.open("PhotoMapDB", 1);
    request.onupgradeneeded = function (event) {
        db = event.target.result;
        let objectStore = db.createObjectStore("photoMarkers", { keyPath: "id", autoIncrement: true });
    
        // 新增 categories 欄位（儲存選擇的分類）
        objectStore.createIndex("categories", "categories", { multiEntry: true });
    };

    request.onsuccess = function (event) {
        db = event.target.result;
        console.log("✅ IndexedDB 成功開啟:", db);
        loadMarkers();
    };
    
    request.onerror = function(event) {
        console.error("IndexedDB 開啟失敗:", event.target.error);
    };

    function loadMarkers() {
        let transaction = db.transaction(["photoMarkers"], "readonly");
        let objectStore = transaction.objectStore("photoMarkers");

        objectStore.openCursor().onsuccess = function (event) {
            let cursor = event.target.result;
            if (cursor) {
                addMarkerToMap(cursor.value);
                cursor.continue();
            }
        };
    }

    fileInput.addEventListener("change", function (event) {
        let files = event.target.files;
        for (let file of files) {
            let reader = new FileReader();
            reader.onload = function (e) {
                let img = new Image();
                img.src = e.target.result;
                img.onload = async function () {
                    EXIF.getData(img, async function () {
                        let lat = EXIF.getTag(this, "GPSLatitude");
                        let lon = EXIF.getTag(this, "GPSLongitude");
                        if (lat && lon) {
                            let latitude = convertDMSToDD(lat);
                            let longitude = convertDMSToDD(lon);
    
                            // ✅ 確保 `compressImage()` 有被 `await`
                            try {
                                let compressedImg = await compressImage(img);
                                saveMarker(latitude, longitude, compressedImg);
                            } catch (error) {
                                console.error("❌ 圖片壓縮失敗：", error);
                            }
                        } else {
                            alert("❌ 照片不含 GPS 資訊");
                        }
                    });
                };
            };
            reader.readAsDataURL(file);
        }
    });
    

    function compressImage(img, quality = 0.5, maxWidth = 800) {
        return new Promise((resolve, reject) => {
            let canvas = document.createElement("canvas");
            let ctx = canvas.getContext("2d");
    
            let scaleFactor = maxWidth / img.width;
            if (scaleFactor > 1) scaleFactor = 1; // 確保不會放大圖片
    
            canvas.width = img.width * scaleFactor;
            canvas.height = img.height * scaleFactor;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
            console.log("🎨 嘗試壓縮圖片...");
            
            // 嘗試使用 WebP，如果失敗就改用 JPEG
            canvas.toBlob((blob) => {
                if (blob) {
                    console.log("✅ WebP 壓縮成功！Blob:", blob);
                    resolve(blob);
                } else {
                    console.warn("⚠️ WebP 失敗，改用 JPEG");
                    canvas.toBlob((jpegBlob) => {
                        if (jpegBlob) {
                            console.log("✅ JPEG 壓縮成功！Blob:", jpegBlob);
                            resolve(jpegBlob);
                        } else {
                            console.error("❌ 轉換 Blob 失敗");
                            reject(new Error("轉換 Blob 失敗"));
                        }
                    }, "image/jpeg", quality);
                }
            }, "image/webp", quality);
        });
    }
    

    async function saveMarker(latitude, longitude, compressedBlob) {
        try {
            console.log("✅ 圖片已壓縮，開始儲存...");
    
            if (!(compressedBlob instanceof Blob)) {
                throw new Error("compressImage() 沒有回傳 Blob");
            }
    
            let reader = new FileReader();
            reader.onloadend = function () {
                let compressedDataUrl = reader.result;
                let transaction = db.transaction(["photoMarkers"], "readwrite");
                let objectStore = transaction.objectStore("photoMarkers");
    
                let markerData = { latitude, longitude, image: compressedDataUrl, name: "未命名照片" };
    
                let request = objectStore.add(markerData);
    
                request.onsuccess = function (event) {
                    markerData.id = event.target.result; // 取得 ID
                    console.log("✅ 照片已壓縮並儲存！");
                    
                    // ✅ 立即顯示照片與標記
                    addMarkerToMap(markerData);
                    console.log("照片成功儲存！");
                    // ✅ 地圖移動到最新的標記點
                    map.flyTo([latitude+0.01, longitude], 15);
                };
            };
            reader.readAsDataURL(compressedBlob);
        } catch (error) {
            console.error("❌ 儲存標記失敗：", error);
        }
    }
    
    async function loadMarkersFromGitHub() {
    const url = "https://raw.githubusercontent.com/piceayee/edit/refs/heads/main/photoMapBackup.json"; // 🔹 替換成你的 JSON 直鏈網址

    try {
        let response = await fetch(url);
        if (!response.ok) throw new Error("❌ 無法獲取 JSON，請檢查網址是否正確");

        let data = await response.json();
        console.log("✅ 成功載入 GitHub JSON:", data);

        // 確保是陣列格式
        if (!Array.isArray(data)) {
            throw new Error("❌ JSON 格式錯誤，應該是陣列");
        }

        // 將標記加入地圖
        data.forEach(markerData => addMarkerToMap(markerData));

    } catch (error) {
        console.error("❌ 載入 GitHub JSON 失敗:", error);
    }
}

       
    function addMarkerToMap(markerData) {
        let markerColor = "gray"; // 預設藍色
        if (markerData.categories) {
            if (markerData.categories.includes("老屋")) {
                markerColor = "red";
            } else if (markerData.categories.includes("磚＆裝飾")) {
                markerColor = "blue";
            } else if (markerData.categories.includes("街景")) {
                markerColor = "green";
            }
        }
    
        let marker = L.marker([markerData.latitude, markerData.longitude], {
            icon: L.icon({
                iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${markerColor}.png`,
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34]
            })
        }).addTo(map)
            .bindPopup(`<strong>${markerData.name}</strong><br><img src="${markerData.image}" width="300"><br>GPS: ${markerData.latitude.toFixed(5)}, ${markerData.longitude.toFixed(5)}`)
            .on("click", function () {
                map.flyTo([markerData.latitude+0.003, markerData.longitude], 17,{ duration: 0.8 });
            });
    
        let listItem = document.createElement("div");
        listItem.className = "photo-item";
        listItem.innerHTML = `
            <img src="${markerData.image}" class="thumbnail">
            <div class="photo-info">
                <input type="text" class="photo-name" placeholder="輸入照片名稱" data-id="${markerData.id}" value="${markerData.name}">
                <div class="category-selection">
                    <label><input type="checkbox" value="老屋"> 老屋</label>
                    <label><input type="checkbox" value="磚＆裝飾"> 磚＆裝飾</label>
                    <label><input type="checkbox" value="街景"> 街景</label>
                </div>
                <button class="go-to-marker">查看</button>
                <button class="delete-photo">刪除</button>
            </div>
        `;
    // ✅ 恢復已選分類
    let checkboxes = listItem.querySelectorAll(".category-selection input");
    checkboxes.forEach(checkbox => {
        if (markerData.categories && markerData.categories.includes(checkbox.value)) {
            checkbox.checked = true;
        }
        checkbox.addEventListener("change", function () {
            let selectedCategories = Array.from(checkboxes)
                .filter(checkbox => checkbox.checked)
                .map(checkbox => checkbox.value);

            updateMarkerCategory(markerData.id, selectedCategories);
        });
    });
    
        // 綁定名稱變更事件
        let nameInput = listItem.querySelector(".photo-name");
        nameInput.addEventListener("focus", function () {
            if (nameInput.value === "未命名照片") {
                nameInput.value = ""; // 清空「未命名照片」，讓使用者直接輸入
            }
        });
        nameInput.addEventListener("change", function () {
            updateMarkerName(markerData.id, nameInput.value);
            marker.bindPopup(`  
            <div class="popup-content">
                <h3 class="popup-title">${markerData.name}</h3>
                <img src="${markerData.image}" width="300">
                <p>GPS: ${markerData.latitude.toFixed(5)}, ${markerData.longitude.toFixed(5)}</p>
            </div>
        `); //上面這段是要解決文字置中跟放大，但沒有順利解決0217
        
                });
    
        // 綁定查看按鈕事件
        listItem.querySelector(".go-to-marker").addEventListener("click", function () {
            map.flyTo([markerData.latitude+0.01, markerData.longitude], 15,{ duration: 0.8 });
            marker.openPopup();
            document.getElementById("map").scrollIntoView({ behavior: "smooth" });
        });
        listItem.querySelector(".thumbnail").addEventListener("click", function () {
            map.flyTo([markerData.latitude+0.01, markerData.longitude], 15, { duration: 0.8 });
            marker.openPopup();
        });
    
        // 綁定刪除按鈕事件
        listItem.querySelector(".delete-photo").addEventListener("click", function () {
            deleteMarker(markerData.id, listItem, marker);
        });
    
        photoList.appendChild(listItem);
    }
    

    function deleteMarker(id, listItem, marker) {
        let transaction = db.transaction(["photoMarkers"], "readwrite");
        let objectStore = transaction.objectStore("photoMarkers");

        objectStore.delete(id).onsuccess = function () {
            console.log(`🗑️ 已刪除照片 ID: ${id}`);
            listItem.remove();
            map.removeLayer(marker);
        };
    }

    function updateMarkerName(id, newName) {
        if (!newName.trim()) {
            newName = "未命名照片"; // 如果使用者沒輸入，使用預設值
        }
        let transaction = db.transaction(["photoMarkers"], "readwrite");
        let objectStore = transaction.objectStore("photoMarkers");
    
        let request = objectStore.get(id);
        request.onsuccess = function () {
            let data = request.result;
            if (data) {
                data.name = newName;
                objectStore.put(data);
            }
        };
    }
    function updateMarkerCategory(id, categories) {
        let transaction = db.transaction(["photoMarkers"], "readwrite");
        let objectStore = transaction.objectStore("photoMarkers");
    
        let request = objectStore.get(id);
        request.onsuccess = function () {
            let data = request.result;
            if (data) {
                data.categories = categories; // 儲存選擇的分類
                objectStore.put(data);
            }
        };
    }
        
    function convertDMSToDD(dms) {
        return dms[0] + dms[1] / 60 + dms[2] / 3600;
    }


    clearMarkersBtn.addEventListener("click", function () {
        let transaction = db.transaction(["photoMarkers"], "readwrite");
        let objectStore = transaction.objectStore("photoMarkers");
        objectStore.clear();
        location.reload();
    });

    document.getElementById("exportData").addEventListener("click", function () {
        let transaction = db.transaction(["photoMarkers"], "readonly");
        let objectStore = transaction.objectStore("photoMarkers");
        let data = [];
    
        objectStore.openCursor().onsuccess = function (event) {
            let cursor = event.target.result;
            if (cursor) {
                data.push(cursor.value);
                cursor.continue();
            } else {
                let jsonData = JSON.stringify(data);
                let blob = new Blob([jsonData], { type: "application/json" });
                let a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "photoMapBackup.json";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                console.log("✅ 資料已匯出");
            }
        };
    });

    document.getElementById("importButton").addEventListener("click", function () {
        document.getElementById("importData").click();
    });
    
    document.getElementById("importData").addEventListener("change", function (event) {
        let file = event.target.files[0];
        if (!file) return;
    
        let reader = new FileReader();
        reader.onload = function (e) {
            try {
                let data = JSON.parse(e.target.result);
    
                if (!Array.isArray(data)) {
                    alert("❌ 匯入失敗，JSON 格式錯誤（應為陣列）");
                    return;
                }
    
                let transaction = db.transaction(["photoMarkers"], "readwrite");
                let objectStore = transaction.objectStore("photoMarkers");
    
                // 先清除所有舊資料
                let clearRequest = objectStore.clear();
    
                clearRequest.onsuccess = function () {
                    console.log("🟢 舊資料已清除，開始匯入新資料...");
    
                    let total = data.length;
                    let successCount = 0;
                    let errorCount = 0;
    
                    data.forEach(marker => {
                        delete marker.id; // 確保不手動設定 id
                        let addRequest = objectStore.add(marker);
    
                        addRequest.onsuccess = function () {
                            successCount++;
                            if (successCount + errorCount === total) {
                                console.log(`✅ 匯入完成！成功：${successCount}，失敗：${errorCount}`);
                                setTimeout(() => location.reload(), 1000); // 重新整理，載入新資料
                            }
                        };
    
                        addRequest.onerror = function () {
                            errorCount++;
                            console.error("❌ 無法新增標記：", marker);
                        };
                    });
    
                    if (total === 0) {
                        console.log("⚠️ JSON 內沒有可匯入的資料！");
                    }
                };
    
                clearRequest.onerror = function () {
                    console.error("❌ 清除舊資料時發生錯誤！");
                };
            } catch (error) {
                alert("❌ 匯入失敗，請檢查 JSON 格式");
                console.error("JSON 解析錯誤：", error);
            }
        };
        reader.readAsText(file);
    });
    
};
