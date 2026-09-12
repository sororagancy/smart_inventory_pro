let html5QrcodeScanner = null;
let offlineQueue = JSON.parse(localStorage.getItem('offlineSyncQueue')) || [];

// متغيرات إدارة الجلسة
let currentMode = null; // 'picking' للعمليات العادية أو 'inventory' للجرد المستمر
let currentId = null; // يحمل ID العملية أو ID المخزن حسب الوضع
let currentLines = []; // مصفوفة المنتجات الحالية
let isScanningPaused = false;
let configTimer = 1500; // الافتراضي ثانية ونصف
let lastOpenedOpType = 'receipt';

// ==========================================
// 1. إدارة التنقل وزر الرجوع بالهاتف (History API)
// ==========================================
window.switchView = function(viewId, pushState = true) {
    // إخفاء جميع الشاشات
    const views = ['view-home', 'view-ops-list', 'view-picking-detail', 'view-create-return', 'view-inventory'];
    views.forEach(id => {
        document.getElementById(id).classList.add('d-none');
    });
    
    // إظهار الشاشة المطلوبة
    document.getElementById(viewId).classList.remove('d-none');
    
    // تسجيل الشاشة في تاريخ المتصفح ليعمل زر رجوع الهاتف
    if (pushState) {
        history.pushState({ view: viewId }, "");
    }
    
    // تهيئة فرعية عند الدخول لشاشات معينة
    if(viewId === 'view-inventory') {
        document.getElementById('inv-setup').classList.remove('d-none');
        document.getElementById('inv-active').classList.add('d-none');
        currentMode = null;
    }
    if(viewId === 'view-home') {
        currentMode = null;
        currentId = null;
        loadCounts(); // تحديث الأرقام فور العودة للرئيسية
    }
}

// الاستماع لزر الرجوع الفعلي في الهاتف
window.addEventListener('popstate', function(event) {
    if (event.state && event.state.view) {
        window.switchView(event.state.view, false);
    } else {
        window.switchView('view-home', false);
    }
});

// ==========================================
// 2. المؤثرات (الإشعارات والاهتزاز)
// ==========================================
function showToast(msg) {
    const toast = document.getElementById('quick-toast');
    toast.innerText = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 1500);
}

function doVibrate(pattern) {
    const isEnabled = document.querySelector('.app-container').getAttribute('data-vibrate') === 'True';
    if (isEnabled && navigator.vibrate) {
        navigator.vibrate(pattern);
    }
}

// ==========================================
// 3. تهيئة الكاميرا
// ==========================================
function startScanner() {
    if (typeof Html5Qrcode !== "undefined") {
        if (!html5QrcodeScanner) {
            html5QrcodeScanner = new Html5Qrcode("reader");
            html5QrcodeScanner.start(
                { facingMode: "environment" }, 
                { fps: 10, qrbox: { width: 250, height: 150 } }, // مساحة تصوير مخصصة للربع العلوي
                onScanSuccess, 
                (e) => { /* تجاهل الأخطاء العابرة */ }
            ).catch(err => console.log("Camera Init Error:", err));
        }
    } else {
        setTimeout(startScanner, 1000);
    }
}

// ==========================================
// 4. جلب وعرض العمليات (Pickings)
// ==========================================
function loadCounts() {
    fetch('/mobile/warehouse/get_counts', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: {} })
    })
    .then(r => r.json())
    .then(d => {
        if (d.result && d.result.status === 'success') {
            document.getElementById('badge-receipt').innerText = d.result.data.receipt;
            document.getElementById('badge-delivery').innerText = d.result.data.delivery;
            document.getElementById('badge-return').innerText = d.result.data.return;
            document.getElementById('badge-internal').innerText = d.result.data.internal;
        }
    }).catch(err => console.log("Offline mode active"));
}

window.loadOperations = function(opType) {
    lastOpenedOpType = opType;
    window.switchView('view-ops-list');
    const contentDiv = document.getElementById('ops-list-content');
    contentDiv.innerHTML = '<p class="text-center mt-3">جاري التحميل...</p>';

    fetch('/mobile/warehouse/get_operations', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { op_type: opType } })
    })
    .then(r => r.json())
    .then(d => {
        if (d.result && d.result.status === 'success') {
            let ops = d.result.data;
            if(ops.length === 0) {
                contentDiv.innerHTML = '<p class="text-warning text-center mt-3">لا توجد عمليات معلقة هنا.</p>';
                return;
            }
            let html = '<ul class="list-unstyled">';
            ops.forEach(op => {
                html += `
                    <li style="background: rgba(255,255,255,0.1); padding: 15px; margin-bottom:10px; border-radius:10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" 
                        onclick="window.openPicking(${op.id}, '${op.name}')">
                        <h6 style="color: #fff; font-weight: bold;">${op.name}</h6>
                        <small style="color: #ddd;">إلى: ${op.location_dest_id ? op.location_dest_id[1] : 'N/A'}</small>
                    </li>`;
            });
            contentDiv.innerHTML = html + '</ul>';
        }
    }).catch(err => {
        contentDiv.innerHTML = '<p class="text-danger text-center mt-3">أنت أوفلاين حالياً!</p>';
    });
}

window.openPicking = function(id, name) {
    currentMode = 'picking';
    currentId = id;
    configTimer = 1500; // تحديد المؤقت بـ ثانية ونصف للعمليات العادية
    
    document.getElementById('page-title').innerText = name;
    window.switchView('view-picking-detail');
    
    document.getElementById('picking-detail-content').innerHTML = '<p class="text-center mt-3">جاري جلب الأسطر...</p>';
    
    fetch('/mobile/warehouse/get_picking_lines', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { picking_id: id } })
    })
    .then(r => r.json())
    .then(d => {
        if (d.result && d.result.status === 'success') {
            currentLines = d.result.data;
            renderPicking();
        }
    });
}

function renderPicking() {
    let html = '';
    currentLines.forEach(l => {
        let done = l.scanned_qty >= l.demand_qty;
        let bgColor = done ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.1)';
        let borderColor = done ? '#4CAF50' : '#FFC107';
        
        html += `
            <div style="background: ${bgColor}; padding: 12px; margin-bottom:12px; border-radius:8px; border-left: 5px solid ${borderColor};">
                <strong style="font-size: 15px; color:#fff;">${l.product_name}</strong><br/>
                <small style="color:#eee;">الباركود: ${l.barcode || '-'}</small>
                <div class="d-flex justify-content-between mt-3">
                    <span class="badge" style="background:#2196F3; font-size:13px;">المطلوب: ${l.demand_qty}</span> 
                    <span class="badge" style="background:${done ? '#4CAF50' : '#FFC107'}; color:#000; font-size:13px;">الممسوح: ${l.scanned_qty}</span>
                </div>
            </div>`;
    });
    
    html += `<button class="btn btn-success w-100 mt-3 py-3" style="border-radius:12px; font-weight:bold; font-size:16px;" onclick="window.savePicking()">حفظ واعتماد (Validate)</button>`;
    document.getElementById('picking-detail-content').innerHTML = html;
}

// ==========================================
// 5. المرتجعات (Returns)
// ==========================================
window.showCreateReturn = function() {
    window.switchView('view-create-return');
    fetch('/mobile/warehouse/get_setup_data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: {} })
    }).then(r => r.json()).then(d => {
        if(d.result && d.result.status === 'success') {
            document.getElementById('ret-partner').innerHTML = d.result.partners.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
            document.getElementById('ret-location').innerHTML = d.result.locations.map(l => `<option value="${l.id}">${l.display_name}</option>`).join('');
        }
    });
}

window.createReturnProcess = function() {
    let type = document.getElementById('ret-type').value;
    let partner = document.getElementById('ret-partner').value;
    let loc = document.getElementById('ret-location').value;
    
    fetch('/mobile/warehouse/create_return', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { return_type: type, partner_id: partner, location_id: loc } })
    }).then(r => r.json()).then(d => {
        if(d.result && d.result.status === 'success') {
            window.openPicking(d.result.picking_id, d.result.picking_name);
        }
    });
}

// ==========================================
// 6. الجرد المستمر (Cycle Count)
// ==========================================
window.showCreateInventory = function() {
    window.switchView('view-inventory');
    fetch('/mobile/warehouse/get_setup_data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: {} })
    }).then(r => r.json()).then(d => {
        if(d.result && d.result.status === 'success') {
            document.getElementById('inv-location').innerHTML = d.result.locations.map(l => `<option value="${l.id}">${l.display_name}</option>`).join('');
        }
    });
}

window.startInventory = function() {
    currentMode = 'inventory';
    currentId = document.getElementById('inv-location').value;
    currentLines = [];
    configTimer = 1000; // تحديد المؤقت بـ ثانية واحدة فقط للجرد السريع
    
    document.getElementById('inv-setup').classList.add('d-none');
    document.getElementById('inv-active').classList.remove('d-none');
    renderInventory();
}

function renderInventory() {
    let html = '';
    // عرض العناصر المعكوسة (الأحدث في الأعلى)
    [...currentLines].reverse().forEach(l => { 
        html += `
            <div style="background: rgba(255,255,255,0.1); padding: 12px; margin-bottom:8px; border-radius:8px; border:1px solid rgba(255,255,255,0.2); display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; font-size:14px;">${l.product_name}</span> 
                <strong class="badge bg-primary" style="font-size:16px; padding:8px 12px;">${l.scanned_qty}</strong>
            </div>`;
    });
    document.getElementById('inv-lines').innerHTML = html;
}

window.saveInventoryCount = function(apply) {
    if(currentLines.length === 0) {
        alert("لم تقم بجرد أي منتج!");
        return;
    }
    
    fetch('/mobile/warehouse/save_inventory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { location_id: currentId, lines: currentLines, apply: apply } })
    }).then(r => r.json()).then(d => {
        if(d.result && d.result.status === 'success') {
            alert(apply ? "تم اعتماد الجرد بنجاح على قاعدة البيانات!" : "تم حفظ تقدم الجرد كمسودة.");
            if(apply) window.switchView('view-home');
        }
    });
}

// ==========================================
// 7. منطق الكاميرا الموحد والخط الأصفر الذكي
// ==========================================
function onScanSuccess(decodedText, decodedResult) {
    if (isScanningPaused || !currentMode) return;

    if (currentMode === 'picking') {
        let line = currentLines.find(l => l.barcode === decodedText);
        if (line) {
            if (line.scanned_qty < line.demand_qty) {
                line.scanned_qty++; 
                renderPicking();
                showToast(`تم مسح: ${line.product_name} (${line.scanned_qty}/${line.demand_qty})`);
                doVibrate(100); 
                pauseCamera();
            } else { 
                doVibrate([200,100,200]); 
                alert("الكمية مكتملة بالكامل لهذا المنتج!"); 
            }
        } else { 
            doVibrate([200,100,200]); 
            alert("هذا المنتج غير مطلوب في هذه العملية!"); 
        }
    
    } else if (currentMode === 'inventory') {
        let line = currentLines.find(l => l.barcode === decodedText);
        if (line) {
            // تحديث سطر موجود
            line.scanned_qty++; 
            renderInventory();
            showToast(`${line.product_name} | إجمالي: ${line.scanned_qty}`);
            doVibrate(100); 
            pauseCamera();
        } else {
            // منتج جديد: يجب إيقاف الكاميرا فوراً لحين الرد من السيرفر
            isScanningPaused = true;
            fetch('/mobile/warehouse/scan_inventory_barcode', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { barcode: decodedText } })
            }).then(r => r.json()).then(d => {
                if(d.result && d.result.status === 'success') {
                    // إضافة سطر جديد بدون تكرار
                    currentLines.push({
                        product_id: d.result.product_id, 
                        product_name: d.result.product_name, 
                        barcode: decodedText, 
                        scanned_qty: 1
                    });
                    renderInventory();
                    showToast(`تمت الإضافة: ${d.result.product_name}`);
                    doVibrate(100); 
                    pauseCamera(true); // تشغيل الخط الأصفر مع تمرير true لتخطي قفل المتغير
                } else {
                    doVibrate([200,100,200]); 
                    alert("باركود غير معروف في النظام!"); 
                    isScanningPaused = false; // إعادة تشغيل الكاميرا فوراً
                }
            }).catch(err => {
                alert("تعذر الاتصال بالسيرفر للبحث عن المنتج.");
                isScanningPaused = false;
            });
        }
    }
}

function pauseCamera(alreadyPaused = false) {
    if(!alreadyPaused) isScanningPaused = true;
    
    const scanMode = document.querySelector('.app-container').getAttribute('data-scan-mode') || 'timer';
    const overlay = document.getElementById('scan-overlay');
    const timerUI = document.getElementById('timer-ui');
    const btnUI = document.getElementById('next-btn-ui');
    const progressBar = document.getElementById('scan-progress-inner');

    overlay.classList.remove('d-none');

    if (scanMode === 'timer') {
        // وضع الخط الأصفر التلقائي
        timerUI.classList.remove('d-none'); 
        btnUI.classList.add('d-none');
        
        progressBar.style.transition = 'none'; 
        progressBar.style.width = '0%';
        
        setTimeout(() => {
            progressBar.style.transition = `width ${configTimer}ms linear`;
            progressBar.style.width = '100%';
        }, 50);

        setTimeout(() => {
            window.resumeScanning();
        }, configTimer);
        
    } else {
        // وضع الزر اليدوي
        timerUI.classList.add('d-none'); 
        btnUI.classList.remove('d-none');
    }
}

window.resumeScanning = function() {
    document.getElementById('scan-overlay').classList.add('d-none');
    isScanningPaused = false;
    
    // فحص تلقائي بعد كل مسحة لو كنا في وضع العمليات لمعرفة ما إذا انتهينا
    if(currentMode === 'picking') {
        if(currentLines.every(l => l.scanned_qty === l.demand_qty)) {
            setTimeout(() => { 
                if(confirm("✅ اكتمل الجرد! هل تريد تصديق واعتماد العملية الآن؟")) {
                    window.savePicking();
                } 
            }, 300);
        }
    }
}

// ==========================================
// 8. حفظ العمليات والمزامنة الأوفلاين (Offline Sync)
// ==========================================
window.savePicking = function() {
    if (!currentId) return;

    let allDone = currentLines.every(l => l.scanned_qty === l.demand_qty);
    if (!allDone) {
        alert("لا يمكن تصديق العملية، الكميات الممسوحة غير مطابقة للكميات المطلوبة!");
        return;
    }

    const payload = {
        picking_id: currentId,
        lines: currentLines.map(l => ({ move_id: l.move_id, scanned_qty: l.scanned_qty }))
    };

    if (navigator.onLine) {
        const syncPayload = { jsonrpc: "2.0", method: "call", params: { payload: { moves: [payload] } } };
        
        fetch('/mobile/warehouse/sync', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(syncPayload)
        })
        .then(response => response.json())
        .then(data => {
            if(data.result && data.result.status === 'success') {
                alert("🎉 تم تصديق العملية بنجاح!");
                window.switchView('view-home');
            } else {
                alert("خطأ أثناء التصديق: " + (data.result ? data.result.message : "مشكلة في السيرفر"));
            }
        });
    } else {
        // حفظ الأوفلاين في الذاكرة المحلية
        offlineQueue.push(payload);
        localStorage.setItem('offlineSyncQueue', JSON.stringify(offlineQueue));
        document.getElementById('sync-status').classList.remove('d-none');
        alert("أنت أوفلاين. تم حفظ العملية محلياً، ستتم المصادقة تلقائياً عند عودة الاتصال.");
        window.switchView('view-home');
    }
}

function syncOfflineData() {
    if (offlineQueue.length > 0 && navigator.onLine) {
        const syncPayload = { jsonrpc: "2.0", method: "call", params: { payload: { moves: offlineQueue } } };
        
        fetch('/mobile/warehouse/sync', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(syncPayload)
        })
        .then(response => response.json())
        .then(data => {
            if(data.result && data.result.status === 'success') {
                offlineQueue = [];
                localStorage.removeItem('offlineSyncQueue');
                document.getElementById('sync-status').classList.add('d-none');
                loadCounts();
                alert("تم مزامنة وتصديق جميع العمليات المحفوظة أوفلاين بنجاح!");
            }
        });
    }
}

// استماع لعودة الإنترنت لرفع البيانات المعلقة
window.addEventListener('online', syncOfflineData);

// ==========================================
// 9. تهيئة التشغيل عند الفتح
// ==========================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { 
        setTimeout(startScanner, 1000); 
        history.replaceState({view: 'view-home'}, ""); 
        loadCounts(); 
        syncOfflineData();
    });
} else {
    setTimeout(startScanner, 1000); 
    history.replaceState({view: 'view-home'}, ""); 
    loadCounts();
    syncOfflineData();
}