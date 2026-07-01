import { UserController } from "./controllers/userController";

export const UserRoute = [
  {
    path: "/me",
    request: null,
    action: UserController.me,
    method: "get",
  },
  {
    path: "/user-export",
    request: null,
    action: UserController.exportUsersCSV,
    method: "get",
  },
  {
    path: "/users",
    request: null,
    action: UserController.getAll,
    method: "get",
  },

  {
    path: "/dashboardStats",
    request: null,
    action: UserController.GetDashboardStats,
    method: "get",
  },
  {
    path: "/update-profile",
    request: null,
    action: UserController.updateProfile,
    method: "put",
  },
  {
    path: "/change-password",
    request: null,
    action: UserController.changePassword,
    method: "put",
  },
  {
    path: "/update-user/:userId",
    request: null,
    action: UserController.updateUserStatus,
    method: "put",
    roles: ["admin"],
  },
  {
    path: "/delete-account",
    request: null,
    action: UserController.deleteAccount,
    method: "delete",
  },
];
