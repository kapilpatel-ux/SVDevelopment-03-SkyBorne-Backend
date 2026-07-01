import { CustomerController } from "./customer.controller";

const _customerController = new CustomerController();

export const CustomerRoute = [
  /**
   * Get my customer profile
   * (only if user has placed at least one order)
   */
  {
    path: "/customers/me",
    request: null,
    action: _customerController.getMyCustomerProfile,
    method: "get",
  },

  /**
   * Admin: Get single customer by id
   */
  {
    path: "/customers/:customerId",
    request: null,
    action: _customerController.getCustomerById,
    method: "get",
    roles: ["admin"],
  },

  /**
   * Add new address
   */
  {
    path: "/customers/address",
    request: null,
    action: _customerController.addAddress,
    method: "post",
  },

  /**
   * Remove address
   */
  {
    path: "/customers/address/:addressId",
    request: null,
    action: _customerController.removeAddress,
    method: "delete",
  },

  /**
   * Admin: Get all customers
   * (ONLY users who have purchased)
   */
  {
    path: "/customers",
    request: null,
    action: _customerController.getAllCustomers,
    method: "get",
    roles: ["admin"],
  },
];