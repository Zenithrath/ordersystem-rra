// ========================================
// API Service Layer (Optimized)
// Caching + Request Deduplication
// ========================================

const ApiService = (() => {
  const API_URL = CONFIG.API_URL;
  const CACHE_TTL = 120000; // 2 minutes client-side cache
  const DEDUP_TTL = 5000;  // 5s dedup window

  // --- Cache ---
  const cache = new Map();
  // --- In-flight requests (dedup) ---
  const inflight = new Map();

  function cacheKey(action, params) {
    return action + "|" + JSON.stringify(params || {});
  }

  function getCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) {
      cache.delete(key);
      return null;
    }
    return entry.data;
  }

  function setCache(key, data) {
    cache.set(key, { data, ts: Date.now() });
  }

  function invalidate(pattern) {
    for (const key of cache.keys()) {
      if (key.startsWith(pattern)) cache.delete(key);
    }
  }

  // --- Core fetch ---
  function apiCall(action, params = {}) {
    const key = cacheKey(action, params);

    // Return cached if available
    const cached = getCache(key);
    if (cached) return Promise.resolve(cached);

    // Dedup: if same request in-flight, return same promise
    if (inflight.has(key)) return inflight.get(key);

    const qs = new URLSearchParams({ action, ...params }).toString();
    const url = API_URL + "?" + qs;

    const promise = fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.success) setCache(key, data);
        inflight.delete(key);
        return data;
      })
      .catch(err => {
        inflight.delete(key);
        return { success: false, message: err.message || "Network error" };
      });

    inflight.set(key, promise);
    return promise;
  }

  // --- Write operations (no cache, always fresh) ---
  function apiWrite(action, data) {
    const params = { data: JSON.stringify(data) };
    const url = API_URL + "?" + new URLSearchParams({ action, ...params }).toString();

    return fetch(url)
      .then(res => res.json())
      .then(result => {
        // Invalidate related caches
        invalidate("getOrders");
        invalidate("getDashboardStats");
        invalidate("getOrderDetail");
        return result;
      })
      .catch(err => ({ success: false, message: err.message || "Network error" }));
  }

  // --- Public API ---

  return {
    // Paginated orders with filters
    getOrders({ page = 1, pageSize = 25, status, department, month, year, q, sort = "date", dir = "desc" } = {}) {
      const params = { page, pageSize, sort, dir };
      if (status) params.status = status;
      if (department) params.department = department;
      if (month) params.month = month;
      if (year) params.year = year;
      if (q) params.q = q;
      return apiCall("getOrders", params);
    },

    // Single order detail (uses local cache from allOrders if available)
    getOrderDetail(id) {
      return apiCall("getOrderDetail", { id });
    },

    // Dashboard stats
    getDashboardStats() {
      return apiCall("getDashboardStats");
    },

    // Departments list
    getDepartments() {
      return apiCall("getDepartments");
    },

    // Create order
    createOrder(orderData) {
      return apiWrite("createOrder", orderData);
    },

    // Update order
    updateOrder(orderData) {
      return apiWrite("updateOrder", orderData);
    },

    // Update order status
    updateOrderStatus(orderId, status) {
      const url = API_URL + "?" + new URLSearchParams({
        action: "updateOrderStatus",
        orderId,
        status
      }).toString();

      return fetch(url)
        .then(res => res.json())
        .then(result => {
          invalidate("getOrders");
          invalidate("getDashboardStats");
          return result;
        })
        .catch(err => ({ success: false, message: err.message || "Network error" }));
    },

    // Delete order
    deleteOrder(id) {
      const url = API_URL + "?" + new URLSearchParams({
        action: "deleteOrder",
        id
      }).toString();

      return fetch(url)
        .then(res => res.json())
        .then(result => {
          invalidate("getOrders");
          invalidate("getDashboardStats");
          return result;
        })
        .catch(err => ({ success: false, message: err.message || "Network error" }));
    },

    // Export Excel (no cache — bypasses caching layer)
    exportExcel(filters = {}) {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.department) params.department = filters.department;
      if (filters.month) params.month = filters.month;
      if (filters.year) params.year = filters.year;
      if (filters.q) params.q = filters.q;

      const qs = new URLSearchParams({ action: "exportExcel", ...params }).toString();
      const url = API_URL + "?" + qs;

      return fetch(url)
        .then(res => res.json())
        .catch(err => ({ success: false, message: err.message || "Network error" }));
    },

    // Cache management
    invalidateAll() {
      cache.clear();
    },

    invalidateOrders() {
      invalidate("getOrders");
    },

    invalidateStats() {
      invalidate("getDashboardStats");
    }
  };
})();
