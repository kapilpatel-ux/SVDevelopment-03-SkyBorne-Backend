import RepositoryAbstract from "../../abstracts/RepositoryAbstract";
import countryRegionHistoryModel, {
  ICountryRegionHistory,
} from "./countryRegionHistory.model";

export default class CountryRegionHistoryRepository extends RepositoryAbstract<ICountryRegionHistory> {
  constructor() {
    super(countryRegionHistoryModel as any, "CountryRegionHistory");
  }
}

