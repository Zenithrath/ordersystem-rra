// ========================================
// API Service Layer
// Work Order Management System
// ========================================

const API = {
  _baseUrl: "",

  init() {
    this._baseUrl = CONFIG.API_URL;
  },

  async _request(method, params = {}, body = null) {
    if (!this._baseUrl) {
      return { success: false, message: "API URL not configured. Set CONFIG.API_URL in config.js" };
    }

    try {
      let url = this._baseUrl;
      let options = {
        method: method,
        redirect: "follow"
      };

      if (method === "GET") {
        const qs = new URLSearchParams(params).toString();
        if (qs) url += "?" + qs;
      } else {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const text = await response.text();

      try {
        return JSON.parse(text);
      } catch (e) {
        return { success: false, message: "Invalid response from server" };
      }
    } catch (err) {
      return { success: false, message: "Network error: " + err.message };
    }
  },

  // ========================================
  // GET Requests
  // ========================================

  async getOrders() {
    return this._request("GET", { action: "getOrders" });
  },

  async getOrderDetail(orderId) {
    return this._request("GET", { action: "getOrderDetail", id: orderId });
  },

  async getDashboardStats() {
    return this._request("GET", { action: "getDashboardStats" });
  },

  async searchOrders(query) {
    return this._request("GET", { action: "searchOrders", q: query });
  },

  async filterOrders(params) {
    return this._request("GET", { action: "filterOrders", ...params });
  },

  async getMasterItems() {
    return this._request("GET", { action: "getMasterItems" });
  },

  async getDepartments() {
    return this._request("GET", { action: "getDepartments" });
  },

  // ========================================
  // POST Requests
  // ========================================

  async createOrder(orderData) {
    return this._request("POST", {}, { action: "createOrder", ...orderData });
  },

  async updateOrder(orderData) {
    return this._request("POST", {}, { action: "updateOrder", ...orderData });
  },

  async updateOrderStatus(orderId, status) {
    return this._request("POST", {}, {
      action: "updateOrderStatus",
      orderId,
      status
    });
  },

  async deleteOrder(orderId) {
    return this._request("POST", {}, { action: "deleteOrder", id: orderId });
  },

  async addMasterItem(item) {
    return this._request("POST", {}, { action: "addMasterItem", ...item });
  },

  async deleteMasterItem(id) {
    return this._request("POST", {}, { action: "deleteMasterItem", id });
  }
};

// ========================================
// Mock Data for Development
// ========================================

const MOCK_DATA = {
  dashboard: {
    totalOrders: 24,
    pendingOrders: 5,
    completedOrders: 12,
    ordersThisMonth: 8,
    inProgressOrders: 4,
    cancelledOrders: 3,
    recentOrders: [
      {
        OrderID: "WO-20260910-001",
        Date: "2026-09-10",
        RequesterName: "Budi Santoso",
        Department: "Engineering",
        Purpose: "Pengadaan material proyek gedung baru",
        Status: "Pending",
        CreatedAt: "2026-09-10T08:30:00.000Z",
        ItemCount: 3
      },
      {
        OrderID: "WO-20260909-003",
        Date: "2026-09-09",
        RequesterName: "Siti Rahayu",
        Department: "Operations",
        Purpose: "Kebutuhan operasional bulanan",
        Status: "In Progress",
        CreatedAt: "2026-09-09T10:15:00.000Z",
        ItemCount: 2
      },
      {
        OrderID: "WO-20260909-002",
        Date: "2026-09-09",
        RequesterName: "Ahmad Fauzi",
        Department: "Project Management",
        Purpose: "Perbaikan area kantor",
        Status: "Completed",
        CreatedAt: "2026-09-09T09:00:00.000Z",
        CompletedAt: "2026-09-09T16:30:00.000Z",
        ItemCount: 4
      },
      {
        OrderID: "WO-20260908-001",
        Date: "2026-09-08",
        RequesterName: "Dewi Lestari",
        Department: "HR & Admin",
        Purpose: "Perlengkapan kantor baru",
        Status: "Completed",
        CreatedAt: "2026-09-08T14:20:00.000Z",
        CompletedAt: "2026-09-08T17:00:00.000Z",
        ItemCount: 2
      },
      {
        OrderID: "WO-20260907-001",
        Date: "2026-09-07",
        RequesterName: "Rudi Hermawan",
        Department: "Logistics",
        Purpose: "Packing dan pengiriman",
        Status: "Cancelled",
        CreatedAt: "2026-09-07T11:45:00.000Z",
        ItemCount: 1
      }
    ]
  },
  orders: [
    {
      OrderID: "WO-20260910-001",
      Date: "2026-09-10",
      RequesterName: "Budi Santoso",
      Department: "Engineering",
      Purpose: "Pengadaan material proyek gedung baru",
      Notes: "Urgent - butuh segera",
      Status: "Pending",
      CreatedAt: "2026-09-10T08:30:00.000Z",
      CompletedAt: "",
      ItemCount: 3,
      Items: [
        { ItemName: "Gypsum Board", Quantity: 20, Unit: "pcs", Notes: "Ukuran 4x8" },
        { ItemName: "Kabel NYM 2x2.5", Quantity: 100, Unit: "meter", Notes: "" },
        { ItemName: "Sekrup Gypsum", Quantity: 5, Unit: "box", Notes: "" }
      ]
    },
    {
      OrderID: "WO-20260909-003",
      Date: "2026-09-09",
      RequesterName: "Siti Rahayu",
      Department: "Operations",
      Purpose: "Kebutuhan operasional bulanan",
      Notes: "",
      Status: "In Progress",
      CreatedAt: "2026-09-09T10:15:00.000Z",
      CompletedAt: "",
      ItemCount: 2,
      Items: [
        { ItemName: "Kertas A4", Quantity: 10, Unit: "box", Notes: "70gsm" },
        { ItemName: "Tinta Printer", Quantity: 3, Unit: "unit", Notes: "Warna hitam" }
      ]
    },
    {
      OrderID: "WO-20260909-002",
      Date: "2026-09-09",
      RequesterName: "Ahmad Fauzi",
      Department: "Project Management",
      Purpose: "Perbaikan area kantor",
      Notes: "Lantai 3",
      Status: "Completed",
      CreatedAt: "2026-09-09T09:00:00.000Z",
      CompletedAt: "2026-09-09T16:30:00.000Z",
      ItemCount: 4,
      Items: [
        { ItemName: "Cat Tembok 20L", Quantity: 3, Unit: "liter", Notes: "Warna putih" },
        { ItemName: "Paku 5cm", Quantity: 2, Unit: "kg", Notes: "" },
        { ItemName: "Tang Potong", Quantity: 1, Unit: "pcs", Notes: "" },
        { ItemName: "Pipa PVC 2 inch", Quantity: 10, Unit: "meter", Notes: "" }
      ]
    },
    {
      OrderID: "WO-20260908-001",
      Date: "2026-09-08",
      RequesterName: "Dewi Lestari",
      Department: "HR & Admin",
      Purpose: "Perlengkapan kantor baru",
      Notes: "Untuk 5 orang karyawan baru",
      Status: "Completed",
      CreatedAt: "2026-09-08T14:20:00.000Z",
      CompletedAt: "2026-09-08T17:00:00.000Z",
      ItemCount: 2,
      Items: [
        { ItemName: "Lemari Arsip", Quantity: 2, Unit: "unit", Notes: "" },
        { ItemName: "Kertas A4", Quantity: 5, Unit: "box", Notes: "" }
      ]
    },
    {
      OrderID: "WO-20260907-001",
      Date: "2026-09-07",
      RequesterName: "Rudi Hermawan",
      Department: "Logistics",
      Purpose: "Packing dan pengiriman",
      Notes: "Dibatalkan karena perubahan jadwal",
      Status: "Cancelled",
      CreatedAt: "2026-09-07T11:45:00.000Z",
      CompletedAt: "",
      ItemCount: 1,
      Items: [
        { ItemName: "Semen Portland", Quantity: 5, Unit: "bag", Notes: "" }
      ]
    },
    {
      OrderID: "WO-20260906-002",
      Date: "2026-09-06",
      RequesterName: "Andi Wijaya",
      Department: "Engineering",
      Purpose: "Instalasi listrik lantai 2",
      Notes: "",
      Status: "Completed",
      CreatedAt: "2026-09-06T08:00:00.000Z",
      CompletedAt: "2026-09-06T15:00:00.000Z",
      ItemCount: 3,
      Items: [
        { ItemName: "Kabel NYM 2x2.5", Quantity: 200, Unit: "meter", Notes: "" },
        { ItemName: "Switch Listrik", Quantity: 10, Unit: "pcs", Notes: "" },
        { ItemName: "Stop Kontak", Quantity: 15, Unit: "pcs", Notes: "" }
      ]
    },
    {
      OrderID: "WO-20260905-001",
      Date: "2026-09-05",
      RequesterName: "Maya Putri",
      Department: "Finance",
      Purpose: "Perlengkapan meja kerja",
      Notes: "Untuk divisi baru",
      Status: "Pending",
      CreatedAt: "2026-09-05T13:00:00.000Z",
      CompletedAt: "",
      ItemCount: 2,
      Items: [
        { ItemName: "Besi Beton 10mm", Quantity: 50, Unit: "meter", Notes: "" },
        { ItemName: "Sarung Tangan", Quantity: 10, Unit: "pair", Notes: "Safety" }
      ]
    }
  ],
  masterItems: [
    { ID: "MI-001", Name: "Tang Potong", Unit: "pcs", Category: "Tools" },
    { ID: "MI-002", Name: "Gypsum Board", Unit: "pcs", Category: "Material" },
    { ID: "MI-003", Name: "Kabel NYM 2x2.5", Unit: "meter", Category: "Electrical" },
    { ID: "MI-004", Name: "Paku 5cm", Unit: "kg", Category: "Hardware" },
    { ID: "MI-005", Name: "Semen Portland", Unit: "bag", Category: "Material" },
    { ID: "MI-006", Name: "Besi Beton 10mm", Unit: "meter", Category: "Material" },
    { ID: "MI-007", Name: "Cat Tembok 20L", Unit: "liter", Category: "Paint" },
    { ID: "MI-008", Name: "Pipa PVC 2 inch", Unit: "meter", Category: "Plumbing" },
    { ID: "MI-009", Name: "Sekrup Gypsum", Unit: "box", Category: "Hardware" },
    { ID: "MI-010", Name: "Switch Listrik", Unit: "pcs", Category: "Electrical" },
    { ID: "MI-011", Name: "Stop Kontak", Unit: "pcs", Category: "Electrical" },
    { ID: "MI-012", Name: "Lemari Arsip", Unit: "unit", Category: "Furniture" },
    { ID: "MI-013", Name: "Kertas A4", Unit: "box", Category: "Office" },
    { ID: "MI-014", Name: "Tinta Printer", Unit: "unit", Category: "Office" },
    { ID: "MI-015", Name: "Sarung Tangan", Unit: "pair", Category: "Safety" }
  ]
};
