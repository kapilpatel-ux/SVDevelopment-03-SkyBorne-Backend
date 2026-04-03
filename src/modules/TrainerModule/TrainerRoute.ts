import TrainerController from "./TrainerController";
import {
  createTrainerSchema,
  updateTrainerSchema,
  getTrainerByIdSchema,
  deleteTrainerSchema,
  getTrainersSchema,
} from "./TrainerValidators";
import type { AppRouteDefinition } from "../../routes/route.types";
const trainerController = new TrainerController();

export const TrainerRoute: AppRouteDefinition[] = [
  {
    path: "/trainers",
    request: getTrainersSchema,
    action: trainerController.getAll,
    method: "get",
  },
   {
    path: "/active-trainers",
    request: getTrainersSchema,
    action: trainerController.getAllActive,
    method: "get",
  },
  {
    path: "/trainers/:id",
    request: getTrainerByIdSchema,
    action: trainerController.getById,
    method: "get",
  },
  {
    path: "/create-trainer",
    request: createTrainerSchema,
    action: trainerController.create,
    method: "post",
  },
  {
    path: "/update-trainer/:id",
    request: updateTrainerSchema,
    action: trainerController.update,
    method: "put",
  },
  {
    path: "/delete-trainer/:id",
    request: deleteTrainerSchema,
    action: trainerController.delete,
    method: "delete",
  },
  {
    path: "/trainer/stats",
    request: null,
    action: TrainerController.GetTrainerStats,
    method: "get",
  },
  {
    path: "/trainer/earnings-list",
    request: null,
    action: TrainerController.getEarningsList,
    method: "get",
  },
   {
    path: "/trainer/earnings-summary",
    request: null,
    action: TrainerController.getEarningsSummary,
    method: "get",
  },
  {
    path: "/trainer/student-growth",
    request: null,
    action: TrainerController.GetStudentGrowth,
    method: "get",
  },
  {
    path: "/trainer/sessions-attendance",
    request: null,
    action: TrainerController.GetSessionsAttendance,
    method: "get",
  },
  {
    path: "/trainer/top-services",
    request: null,
    action: TrainerController.GetTopServices,
    method: "get",
  },
];
