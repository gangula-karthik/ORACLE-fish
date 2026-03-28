import { randomUUID } from "crypto";
import type { SourceDocument, PresetScenarioId } from "./types";

interface FallbackParams {
  runId: string;
  presetId?: PresetScenarioId;
  title: string;
  policyChange: string;
}

const FALLBACK_BY_PRESET: Record<PresetScenarioId, Array<Omit<SourceDocument, "id" | "runId" | "scrapedAt">>> = {
  gst_9_to_10: [
    {
      url: "https://www.mof.gov.sg/singaporebudget/budget-2024/budget-at-a-glance",
      publisher: "Ministry of Finance Singapore",
      title: "Budget 2024 – GST and Assurance Package",
      publishDate: "2024-02-16",
      excerpt:
        "The GST rate was raised from 8% to 9% on 1 January 2024 as part of a two-step increase announced in Budget 2022. The Government has put in place a comprehensive Assurance Package worth $9.9 billion to help Singaporeans, especially lower- and middle-income households, cope with the increase. The package includes cash payouts, MediSave top-ups, Community Development Council (CDC) vouchers, and additional GST Voucher disbursements. The Government has emphasised that the revenue from the GST increase is needed to fund healthcare and social spending.",
      relevanceTags: ["GST", "Assurance Package", "tax relief", "Budget 2024", "cost of living"],
    },
    {
      url: "https://www.parliament.gov.sg/news/topics/goods-and-services-tax",
      publisher: "Parliament of Singapore",
      title: "Parliamentary Debates on GST Rate Increase",
      publishDate: "2024-01-10",
      excerpt:
        "Members of Parliament debated the impact of the GST increase during the Budget debate. Several MPs raised concerns from residents in their constituencies about the rising cost of living. The Minister for Finance responded that the Assurance Package is sized to offset the GST increase for the majority of Singaporean households for at least five years. Opposition members called for greater transparency in how GST revenue would be deployed, while PAP backbenchers expressed support for the Government's fiscal strategy.",
      relevanceTags: ["GST", "Parliament", "Budget debate", "cost of living", "Assurance Package"],
    },
    {
      url: "https://www.parliament.gov.sg/news/topics/gst",
      publisher: "Parliament of Singapore",
      title: "GST Voucher Scheme and Support Measures",
      publishDate: "2024-02-20",
      excerpt:
        "The GST Voucher scheme provides permanent annual support to lower-income Singaporeans. The Cash component gives up to $850 per year to eligible adults. The MediSave component provides $150-$450 per year for elderly Singaporeans. The U-Save component helps HDB households with utility bills. In addition, the one-off Assurance Package provides additional CDC vouchers worth $300-$500 per household and senior additional cash payouts. The Government has committed to reviewing the scheme annually to ensure adequacy.",
      relevanceTags: ["GST Voucher", "CDC vouchers", "MediSave", "U-Save", "support measures"],
    },
  ],
  transport_fare_hike: [
    {
      url: "https://www.ptc.gov.sg/fare-information/fare-review",
      publisher: "Public Transport Council Singapore",
      title: "2024 Fare Review Exercise",
      publishDate: "2024-10-01",
      excerpt:
        "The Public Transport Council announced a fare increase of up to 6% for public bus and MRT services, effective December 2024. The increase is driven by higher energy costs, increased staff wages under the National Wages Council guidelines, and infrastructure maintenance costs. Concession fares for students, senior citizens, and persons with disabilities remain subsidised. The Government's Bus Contracting Model and Rail Financing Framework continue to shield commuters from the full cost of service provision.",
      relevanceTags: ["transport fare", "MRT", "bus", "PTC", "commuter"],
    },
    {
      url: "https://www.mot.gov.sg/what-we-do/public-transport",
      publisher: "Ministry of Transport Singapore",
      title: "Public Transport Affordability Measures",
      publishDate: "2024-09-15",
      excerpt:
        "The Ministry of Transport has put in place multiple measures to ensure public transport remains affordable. The Public Transport Fund provides monthly travel credits of up to $60 for lower-income commuters who travel frequently. All residents receive $50 in CDC vouchers usable for transport. Senior citizens aged 65 and above can travel for $0.50 per trip on weekdays. The Government subsidises 40-50% of total public transport costs through the national budget, keeping fares well below operating costs.",
      relevanceTags: ["affordability", "Public Transport Fund", "subsidies", "concession fares"],
    },
    {
      url: "https://data.gov.sg/datasets/public-transport-ridership",
      publisher: "Land Transport Authority",
      title: "Public Transport Ridership Statistics",
      publishDate: "2024-08-01",
      excerpt:
        "Daily public transport ridership reached 7.2 million trips in Q2 2024, recovering to pre-pandemic levels. MRT accounts for 3.1 million trips daily, while buses account for 3.8 million. The average commuter spends $70-$90 per month on public transport. Surveys indicate 85% of respondents consider public transport affordable relative to private car ownership. However, lower-income households in non-central areas spend a higher proportion of income on transport despite concession schemes.",
      relevanceTags: ["ridership", "statistics", "affordability", "lower income", "LTA"],
    },
  ],
  hdb_policy: [
    {
      url: "https://www.hdb.gov.sg/about-us/news-and-publications/press-releases/bto-launch-2024",
      publisher: "Housing & Development Board",
      title: "HDB BTO and Resale Policy Updates 2024",
      publishDate: "2024-03-01",
      excerpt:
        "HDB launched 19,600 Build-To-Order (BTO) flats in 2024 across multiple towns including Tengah, Woodlands, and Bedok. New flats under the Prime Location Public Housing (PLH) model come with tighter resale conditions, including a 10-year Minimum Occupation Period and a clawback of subsidies upon resale. The Government has introduced the HDB Flat Eligibility (HFE) letter to streamline the application process. Enhanced CPF Housing Grants provide up to $120,000 for first-timer families buying resale flats.",
      relevanceTags: ["BTO", "HDB", "PLH", "resale", "housing grant", "CPF"],
    },
    {
      url: "https://www.mnd.gov.sg/newsroom/speeches/view/ministerial-statement-on-public-housing",
      publisher: "Ministry of National Development",
      title: "Ministerial Statement on Public Housing Affordability",
      publishDate: "2024-07-02",
      excerpt:
        "The Minister for National Development addressed Parliament on measures to ensure public housing remains affordable for Singaporeans. He noted that HDB flats are priced with significant subsidies - new BTO flats are priced below comparable resale flats. The Government will continue to supply sufficient flats to meet demand, with 100,000 new flats planned over five years. Concerns about the widening price gap between mature and non-mature estate flats were acknowledged, and the PLH model is intended to moderate prices in prime areas.",
      relevanceTags: ["public housing", "affordability", "subsidies", "BTO supply", "MND"],
    },
    {
      url: "https://www.parliament.gov.sg/news/topics/housing",
      publisher: "Parliament of Singapore",
      title: "Parliamentary Questions on HDB Resale Prices",
      publishDate: "2024-05-14",
      excerpt:
        "Multiple parliamentary questions were filed on rising HDB resale prices, with several flats transacting above $1 million in mature estates. The Minister responded that million-dollar HDB flats represent less than 1% of total transactions and are concentrated in premium locations. Cooling measures introduced in September 2022, including lower loan-to-value limits and increased Additional Buyer's Stamp Duty for investment purchases, have moderated the market. The Government remains committed to ensuring the majority of Singaporeans can afford a new HDB flat.",
      relevanceTags: ["resale prices", "cooling measures", "ABSD", "Parliament", "million-dollar flats"],
    },
  ],
  cpf_changes: [
    {
      url: "https://www.cpf.gov.sg/member/infohub/news/cpf-related-announcements/cpf-changes-2024",
      publisher: "Central Provident Fund Board",
      title: "CPF Changes and Basic Retirement Sum 2024",
      publishDate: "2024-01-01",
      excerpt:
        "The CPF Basic Retirement Sum (BRS) was raised to $102,900 for members turning 55 in 2024, a 3.5% increase from 2023. The Full Retirement Sum (FRS) is set at $205,800 and the Enhanced Retirement Sum (ERS) at $308,700. CPF LIFE payouts are estimated at $730-$790 per month for members on the BRS. The Ordinary Account interest rate remains at 2.5% per annum and the Special/Medisave Account at 4% per annum. The Government has committed to maintaining CPF interest rates above prevailing market rates.",
      relevanceTags: ["CPF", "Basic Retirement Sum", "CPF LIFE", "retirement", "interest rates"],
    },
    {
      url: "https://www.mof.gov.sg/docs/librariesprovider3/budget2024/cpf-contribution",
      publisher: "Ministry of Finance Singapore",
      title: "CPF Contribution Rate Increases for Senior Workers",
      publishDate: "2024-01-01",
      excerpt:
        "CPF contribution rates for workers aged 55-60 were increased by 1.5 percentage points (split between employer and employee) as part of the Tripartite Workgroup recommendations. Workers aged 60-65 saw a 1 percentage point increase. These changes are part of a roadmap to align senior worker CPF rates closer to those of younger workers by 2030, improving retirement adequacy. Employers in labour-intensive sectors may access transitional offset funding to ease the adjustment.",
      relevanceTags: ["CPF contributions", "senior workers", "retirement adequacy", "employer", "Tripartite"],
    },
    {
      url: "https://www.parliament.gov.sg/news/topics/central-provident-fund",
      publisher: "Parliament of Singapore",
      title: "Parliamentary Debates on CPF Withdrawal and Retirement Adequacy",
      publishDate: "2024-04-08",
      excerpt:
        "Parliamentary debates on CPF centred on retirement adequacy and flexibility of CPF withdrawals. Opposition members proposed lowering the Retirement Sum to allow more immediate withdrawals at age 55. The Government maintained that the Retirement Sum framework is essential to ensure lifelong income through CPF LIFE. MPs also discussed the adequacy of CPF savings for self-employed persons, who are not subject to mandatory contributions beyond MediSave. A new voluntary contribution scheme for platform workers will require mandatory MediSave contributions from 2024.",
      relevanceTags: ["CPF withdrawal", "retirement adequacy", "self-employed", "platform workers", "Parliament"],
    },
  ],
};

const GENERIC_FALLBACK: Array<Omit<SourceDocument, "id" | "runId" | "scrapedAt">> = [
  {
    url: "https://www.gov.sg/article/singapore-government-policy",
    publisher: "Singapore Government",
    title: "Singapore Government Policy Framework",
    publishDate: "2024-01-01",
    excerpt:
      "The Singapore Government adopts a pragmatic and evidence-based approach to policymaking. Policies are regularly reviewed against economic conditions, social outcomes, and feedback from citizens. Public consultations, parliamentary debates, and feedback from grassroots organisations inform policy refinements. The Government aims to balance fiscal sustainability with social support, ensuring that vulnerable groups are protected while maintaining Singapore's long-term competitiveness.",
    relevanceTags: ["Singapore policy", "government", "social support", "fiscal sustainability"],
  },
  {
    url: "https://www.reach.gov.sg/Participate/eFeedback",
    publisher: "REACH Singapore",
    title: "Citizen Feedback on Government Policies",
    publishDate: "2024-06-01",
    excerpt:
      "REACH, the Government's feedback arm, collects views from Singaporeans on a wide range of policies. Recent surveys indicate that cost of living remains the top concern for most residents, followed by housing affordability and healthcare costs. The majority of respondents across income groups express support for targeted assistance schemes, though awareness of available schemes varies. The Government uses this feedback to refine communication and calibrate support measures.",
    relevanceTags: ["citizen feedback", "cost of living", "REACH", "public opinion", "support schemes"],
  },
];

export function getFallbackDocuments(params: FallbackParams): SourceDocument[] {
  const now = new Date().toISOString();
  const docsBase =
    params.presetId && FALLBACK_BY_PRESET[params.presetId]
      ? FALLBACK_BY_PRESET[params.presetId]
      : GENERIC_FALLBACK;

  return docsBase.map((d) => ({
    ...d,
    id: randomUUID(),
    runId: params.runId,
    scrapedAt: now,
  }));
}
