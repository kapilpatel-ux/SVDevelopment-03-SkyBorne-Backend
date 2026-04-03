import { CountryController } from "./country.controller";
import type { AppRouteDefinition } from "../../routes/route.types";

const _countryController = new CountryController();

export const CountryRoute: AppRouteDefinition[] = [
  // Get all countries with pagination
  {
    path: "/countries",
    request: null,
    action: _countryController.getAllCountries,
    method: "get",
  },

  // Get single country by ID
  {
    path: "/countries/:countryId",
    request: null,
    action: _countryController.getCountryById,
    method: "get",
  },

  // Create new country
  {
    path: "/create-country",
    request: null,
    action: _countryController.createCountry,
    method: "post",
  },

  // Update country (full update)
  {
    path: "/update-country/:countryId",
    request: null,
    action: _countryController.updateCountry,
    method: "put",
  },

  // Update country status only
  {
    path: "//:countryId",
    request: null,
    action: _countryController.updateCountryStatus,
    method: "patch",
  },

  // Delete country
  {
    path: "/delete-country/:countryId",
    request: null,
    action: _countryController.deleteCountry,
    method: "delete",
  },
];
