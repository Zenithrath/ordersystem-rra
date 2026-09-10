// ========================================
// Work Order Management System - Backend
// Google Apps Script Web App
// ========================================

const SHEET_ORDERS = "ORDERS";
const SHEET_ITEMS = "ORDER_ITEMS";
const SHEET_MASTER = "MASTER_ITEMS";

// ========================================
// HTTP Handlers
// ========================================

function doGet(e) {
  const action = (e && e.parameter) ? e.parameter.action : "getDashboardStats";
  let result;

  try {
    switch (action) {
      case "getOrders":
        result = getOrders(e.parameter);
        break;
      case "getOrderDetail":
        result = getOrderDetail(e.parameter.id);
        break;
      case "getDashboardStats":
        result = getDashboardStats();
        break;
      case "searchOrders":
        result = searchOrders(e.parameter.q);
        break;
      case "filterOrders":
        result = filterOrders(e.parameter);
        break;
      case "getDepartments":
        result = getDepartments();
        break;
      case "createOrder":
        var data = JSON.parse(e.parameter.data);
        result = createOrder(data);
        break;
      case "updateOrder":
        var data = JSON.parse(e.parameter.data);
        result = updateOrder(data);
        break;
      case "updateOrderStatus":
        result = updateOrderStatus({
          orderId: e.parameter.orderId,
          status: e.parameter.status
        });
        break;
      case "deleteOrder":
        result = deleteOrder(e.parameter.id);
        break;
      default:
        result = { success: false, message: "Unknown action: " + action };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;

  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case "createOrder":
        result = createOrder(body);
        break;
      case "updateOrder":
        result = updateOrder(body);
        break;
      case "updateOrderStatus":
        result = updateOrderStatus(body);
        break;
      case "deleteOrder":
        result = deleteOrder(body.id);
        break;
      case "addMasterItem":
        result = addMasterItem(body);
        break;
      case "deleteMasterItem":
        result = deleteMasterItem(body.id);
        break;
      default:
        result = { success: false, message: "Unknown action: " + action };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// Sheet Helpers
// ========================================

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_ORDERS) {
      sheet.appendRow([
        "OrderID", "Date", "RequesterName", "Department",
        "Purpose", "Notes", "Status", "CreatedAt", "CompletedAt", "CreatedBy"
      ]);
    } else if (name === SHEET_ITEMS) {
      sheet.appendRow(["OrderID", "ItemName", "Quantity", "Unit", "Notes"]);
    } else if (name === SHEET_MASTER) {
      sheet.appendRow(["ID", "Name", "Unit", "Category"]);
      const defaults = [
        ["Tang Potong", "pcs", "Tools"],
        ["Gypsum Board", "pcs", "Material"],
        ["Kabel NYM 2x2.5", "meter", "Electrical"],
        ["Paku 5cm", "kg", "Hardware"],
        ["Semen Portland", "bag", "Material"],
        ["Besi Beton 10mm", "meter", "Material"],
        ["Cat Tembok 20L", "liter", "Paint"],
        ["Pipa PVC 2 inch", "meter", "Plumbing"],
        ["Sekrup Gypsum", "box", "Hardware"],
        ["Switch Listrik", "pcs", "Electrical"],
        ["Stop Kontak", "pcs", "Electrical"],
        ["Lemari Arsip", "unit", "Furniture"],
        ["Kertas A4", "box", "Office"],
        ["Tinta Printer", "unit", "Office"],
        ["Sarung Tangan", "pair", "Safety"]
      ];
      defaults.forEach((item, i) => {
        sheet.appendRow(["MI-" + String(i + 1).padStart(3, "0"), item[0], item[1], item[2]]);
      });
    }
  }
  return sheet;
}

function generateOrderID() {
  const sheet = getSheet(SHEET_ORDERS);
  const today = new Date();
  const dateStr = Utilities.formatDate(today, "Asia/Jakarta", "yyyyMMdd");
  const prefix = "WO-" + dateStr + "-";

  const data = sheet.getDataRange().getValues();
  let maxNum = 0;

  for (let i = 1; i < data.length; i++) {
    const orderId = data[i][0];
    if (orderId && orderId.startsWith(prefix)) {
      const num = parseInt(orderId.split("-")[2], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return prefix + String(maxNum + 1).padStart(3, "0");
}

function getDataAsObjects(sheetName) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, j) => {
      obj[h] = data[i][j];
    });
    rows.push(obj);
  }

  return rows;
}

// ========================================
// Core Functions
// ========================================

function getOrders(params) {
  const orders = getDataAsObjects(SHEET_ORDERS);
  const items = getDataAsObjects(SHEET_ITEMS);

  const enriched = orders.map(order => {
    const orderItems = items.filter(it => it.OrderID === order.OrderID);
    return {
      ...order,
      ItemCount: orderItems.length,
      Items: orderItems
    };
  });

  enriched.sort((a, b) => {
    const dateA = new Date(a.CreatedAt);
    const dateB = new Date(b.CreatedAt);
    return dateB - dateA;
  });

  return { success: true, data: enriched };
}

function getOrderDetail(orderId) {
  if (!orderId) return { success: false, message: "Order ID is required" };

  const orders = getDataAsObjects(SHEET_ORDERS);
  const items = getDataAsObjects(SHEET_ITEMS);

  const order = orders.find(o => o.OrderID === orderId);
  if (!order) return { success: false, message: "Order not found" };

  const orderItems = items.filter(it => it.OrderID === orderId);

  return {
    success: true,
    data: { ...order, Items: orderItems }
  };
}

function getDashboardStats() {
  const orders = getDataAsObjects(SHEET_ORDERS);
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const totalOrders = orders.length;
  const pendingOrders = orders.filter(o => o.Status === "Pending").length;
  const completedOrders = orders.filter(o => o.Status === "Completed").length;

  const ordersThisMonth = orders.filter(o => {
    const d = new Date(o.Date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).length;

  const inProgressOrders = orders.filter(o => o.Status === "In Progress").length;
  const cancelledOrders = orders.filter(o => o.Status === "Cancelled").length;

  const recentOrders = orders
    .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt))
    .slice(0, 5);

  const items = getDataAsObjects(SHEET_ITEMS);
  const recentWithItems = recentOrders.map(order => ({
    ...order,
    ItemCount: items.filter(it => it.OrderID === order.OrderID).length
  }));

  return {
    success: true,
    data: {
      totalOrders,
      pendingOrders,
      completedOrders,
      ordersThisMonth,
      inProgressOrders,
      cancelledOrders,
      recentOrders: recentWithItems
    }
  };
}

function searchOrders(query) {
  if (!query) return getOrders({});

  const q = query.toLowerCase();
  const orders = getDataAsObjects(SHEET_ORDERS);
  const items = getDataAsObjects(SHEET_ITEMS);

  const filtered = orders.filter(order => {
    if (order.OrderID && order.OrderID.toLowerCase().includes(q)) return true;
    if (order.RequesterName && order.RequesterName.toLowerCase().includes(q)) return true;

    const orderItems = items.filter(it => it.OrderID === order.OrderID);
    return orderItems.some(it =>
      it.ItemName && it.ItemName.toLowerCase().includes(q)
    );
  });

  const enriched = filtered.map(order => {
    const orderItems = items.filter(it => it.OrderID === order.OrderID);
    return { ...order, ItemCount: orderItems.length, Items: orderItems };
  });

  return { success: true, data: enriched };
}

function filterOrders(params) {
  let orders = getDataAsObjects(SHEET_ORDERS);
  const items = getDataAsObjects(SHEET_ITEMS);

  if (params.status) {
    orders = orders.filter(o => o.Status === params.status);
  }
  if (params.department) {
    orders = orders.filter(o => o.Department === params.department);
  }
  if (params.month && params.year) {
    const m = parseInt(params.month) - 1;
    const y = parseInt(params.year);
    orders = orders.filter(o => {
      const d = new Date(o.Date);
      return d.getMonth() === m && d.getFullYear() === y;
    });
  } else if (params.year) {
    const y = parseInt(params.year);
    orders = orders.filter(o => new Date(o.Date).getFullYear() === y);
  }

  if (params.sort) {
    const dir = params.dir === "asc" ? 1 : -1;
    orders.sort((a, b) => {
      if (params.sort === "date") {
        return dir * (new Date(a.Date) - new Date(b.Date));
      } else if (params.sort === "orderId") {
        return dir * a.OrderID.localeCompare(b.OrderID);
      }
      return 0;
    });
  } else {
    orders.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
  }

  const enriched = orders.map(order => {
    const orderItems = items.filter(it => it.OrderID === order.OrderID);
    return { ...order, ItemCount: orderItems.length, Items: orderItems };
  });

  return { success: true, data: enriched };
}

function createOrder(body) {
  const {
    date, requesterName, department, purpose, notes, items, createdBy
  } = body;

  if (!requesterName || !department || !items || items.length === 0) {
    return { success: false, message: "Missing required fields" };
  }

  const orderId = generateOrderID();
  const now = new Date().toISOString();
  const orderDate = date || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");

  const ordersSheet = getSheet(SHEET_ORDERS);
  ordersSheet.appendRow([
    orderId, orderDate, requesterName, department,
    purpose || "", notes || "", "Pending", now, "", createdBy || "system"
  ]);

  const itemsSheet = getSheet(SHEET_ITEMS);
  items.forEach(item => {
    itemsSheet.appendRow([
      orderId,
      item.itemName,
      item.quantity || 0,
      item.unit || "pcs",
      item.notes || ""
    ]);
  });

  return {
    success: true,
    message: "Order created successfully",
    data: { orderId }
  };
}

function updateOrder(body) {
  const {
    orderId, date, requesterName, department, purpose, notes, items
  } = body;

  if (!orderId) return { success: false, message: "Order ID is required" };

  const ordersSheet = getSheet(SHEET_ORDERS);
  const data = ordersSheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) return { success: false, message: "Order not found" };

  if (date) ordersSheet.getRange(rowIndex, 2).setValue(date);
  if (requesterName) ordersSheet.getRange(rowIndex, 3).setValue(requesterName);
  if (department) ordersSheet.getRange(rowIndex, 4).setValue(department);
  if (purpose !== undefined) ordersSheet.getRange(rowIndex, 5).setValue(purpose);
  if (notes !== undefined) ordersSheet.getRange(rowIndex, 6).setValue(notes);

  if (items && Array.isArray(items)) {
    const itemsSheet = getSheet(SHEET_ITEMS);
    const itemData = itemsSheet.getDataRange().getValues();
    const rowsToDelete = [];

    for (let i = 1; i < itemData.length; i++) {
      if (itemData[i][0] === orderId) {
        rowsToDelete.push(i + 1);
      }
    }

    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      itemsSheet.deleteRow(rowsToDelete[i]);
    }

    items.forEach(item => {
      itemsSheet.appendRow([
        orderId,
        item.itemName,
        item.quantity || 0,
        item.unit || "pcs",
        item.notes || ""
      ]);
    });
  }

  return { success: true, message: "Order updated successfully" };
}

function updateOrderStatus(body) {
  const { orderId, status } = body;

  if (!orderId || !status) {
    return { success: false, message: "Order ID and status are required" };
  }

  const validStatuses = ["Pending", "In Progress", "Completed", "Cancelled"];
  if (!validStatuses.includes(status)) {
    return { success: false, message: "Invalid status" };
  }

  const ordersSheet = getSheet(SHEET_ORDERS);
  const data = ordersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      const row = i + 1;
      ordersSheet.getRange(row, 7).setValue(status);

      if (status === "Completed") {
        ordersSheet.getRange(row, 9).setValue(new Date().toISOString());
      } else if (status !== "Completed") {
        ordersSheet.getRange(row, 9).setValue("");
      }

      return { success: true, message: "Status updated to " + status };
    }
  }

  return { success: false, message: "Order not found" };
}

function deleteOrder(orderId) {
  if (!orderId) return { success: false, message: "Order ID is required" };

  const ordersSheet = getSheet(SHEET_ORDERS);
  const data = ordersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      ordersSheet.deleteRow(i + 1);
      break;
    }
  }

  const itemsSheet = getSheet(SHEET_ITEMS);
  const itemData = itemsSheet.getDataRange().getValues();
  const rowsToDelete = [];

  for (let i = 1; i < itemData.length; i++) {
    if (itemData[i][0] === orderId) {
      rowsToDelete.push(i + 1);
    }
  }

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    itemsSheet.deleteRow(rowsToDelete[i]);
  }

  return { success: true, message: "Order deleted successfully" };
}

// ========================================
// Master Data
// ========================================

function getMasterItems() {
  return { success: true, data: getDataAsObjects(SHEET_MASTER) };
}

function addMasterItem(body) {
  const { name, unit, category } = body;
  if (!name) return { success: false, message: "Item name is required" };

  const sheet = getSheet(SHEET_MASTER);
  const data = sheet.getDataRange().getValues();
  const newId = "MI-" + String(data.length).padStart(3, "0");

  sheet.appendRow([newId, name, unit || "pcs", category || "General"]);
  return { success: true, message: "Item added", data: { id: newId } };
}

function deleteMasterItem(id) {
  if (!id) return { success: false, message: "ID is required" };

  const sheet = getSheet(SHEET_MASTER);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { success: true, message: "Item deleted" };
    }
  }

  return { success: false, message: "Item not found" };
}

function getDepartments() {
  return {
    success: true,
    data: [
      "Engineering", "Project Management", "Procurement",
      "Operations", "Finance", "HR & Admin", "IT",
      "Marketing", "Logistics", "Other"
    ]
  };
}
