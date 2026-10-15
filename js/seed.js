/* ============================================================
   seed.js — reference datasets + initial demo material master
   ============================================================ */
(function () {

    /* ---- Plants (SAP) ---- */
    const PLANTS = [
        { code: '1000', name: 'SOCAR Baş ofis' },
        { code: '1001', name: 'Azərbaycan Neft Təsərrüfatı' },
        { code: '1002', name: 'Əmək şəraiti normalarının işlənməsi İdarəsi' },
        { code: '1004', name: 'Təlim, Tədris və Sert. Idarəsi' },
        { code: '1008', name: 'Sənaye Təhlükəsizlik İdarəsi' },
        { code: '1100', name: 'Azneft İB' },
        { code: '1101', name: 'Abşeronneft NQÇİ' },
        { code: '1102', name: 'Ə.Əmirov adına NQÇİ' },
        { code: '1104', name: 'Bibiheybətneft NQÇİ' },
        { code: '1107', name: 'N. Nərimanov  NQÇİ' },
        { code: '1108', name: 'Neft Daşları NQÇİ' },
        { code: '1109', name: 'Siyəzənneft NQÇİ' },
        { code: '1110', name: '28 May NQÇİ' },
        { code: '1112', name: 'Dalma qurğularının təmiri və' },
        { code: '1121', name: 'Qaz anbarlarının istismarı İd.' },
        { code: '1122', name: 'Azneft İB-nin MTT İdarəsi' },
        { code: '1123', name: 'Dalğıc Xidməti' },
        { code: '1125', name: '1 s İx.Neft-Mədən XTİ' },
        { code: '1126', name: '2 s İx.Neft-Mədən XTİ' },
        { code: '1200', name: 'Geofizika və Geologiya idarəsi' },
        { code: '1300', name: 'Neft Kəmərləri idarəsi' },
        { code: '1400', name: 'Marketinq və İqtisadi' },
        { code: '1427', name: 'Neft məhsullarının qəbulu və g' },
        { code: '1700', name: 'H.Əliyev adına NEZ' },
        { code: '1800', name: 'H.Əliyev adına BDÖZ' },
        { code: '1900', name: 'SOCAR Sosial İnkişaf Idarəsi' },
        { code: '1901', name: 'Bakı Olimpiya Stadionu' },
        { code: '1902', name: 'Qubek Hotel' },
        { code: '2000', name: 'Təhlükəsizlik Idarəsi' },
        { code: '2200', name: 'Aparat Qaz İxracı' },
        { code: '2202', name: 'Hacıqabul Magistral QKS' },
        { code: '2203', name: 'Ağdaş Magistral QKS' },
        { code: '2204', name: 'Siyəzən Magistral QKS' },
        { code: '2205', name: 'Ağdam Magistral QKS' },
        { code: '2206', name: 'Astara Magistral QKS' },
        { code: '2207', name: 'Qazax Magistral QKS' },
        { code: '2208', name: 'Abşeron Magistral QKS' },
        { code: '2211', name: 'Mərkəzləşdirilmiş Q/B və T/T' },
        { code: '2212', name: 'Naxçıvan MQKS' },
        { code: '2300', name: 'İnfor.  Tex. və Rabitə İdarəsi' },
        { code: '2500', name: 'NeftQaztikinti tresti' },
        { code: '2600', name: 'Kompleks Qazma İşləri Tresti' },
        { code: '2800', name: 'Neftqazelmitədqiqatlayihə İnst' },
        { code: '2900', name: 'Azəriqaz  Istehsalat Birliyi' },
        { code: '2909', name: 'Anbar Təsərrüfatı' },
        { code: '2910', name: 'Təmir - tikinti idarəsi' },
        { code: '2911', name: 'Abşeron QİS' },
        { code: '2912', name: 'Səbail rayon QİS' },
        { code: '2913', name: 'Sabunçu rayon  QİS' },
        { code: '2914', name: 'Nizami rayon QİS' },
        { code: '2915', name: 'Nərimanov rayon QİS' },
        { code: '2916', name: 'Nəsimi rayon QİS' },
        { code: '2917', name: 'Xəzər rayon QİS' },
        { code: '2918', name: 'Binəqədi rayon QİS' },
        { code: '2919', name: 'Suraxanı rayon QİS' },
        { code: '2920', name: 'Yasamal rayon QİS' },
        { code: '2921', name: 'Qaradağ rayon QİS' },
        { code: '2922', name: 'Xətai rayon QİS' },
        { code: '2932', name: 'SUMQAYIT  QİS' },
        { code: '2933', name: 'Zaqatala Regional Qİİ' },
        { code: '2935', name: 'Xaçmaz Regional Qİİ' },
        { code: '2936', name: 'Salyan Regional Qİİ' },
        { code: '2937', name: 'Lənkəran Regional Qİİ' },
        { code: '2938', name: 'Tərtər Regional Qİİ' },
        { code: '2939', name: 'Ağsu Regional Qİİ' },
        { code: '2940', name: 'Şəmkir Regional Qİİ' },
        { code: '2941', name: 'Gəncə Regional Qİİ' },
        { code: '2944', name: 'Regional Qazın Satışı Departam' },
        { code: '2946', name: 'Qarabağ Regional Qİİ' },
        { code: '2947', name: 'Bakı Regional Qİİ' },
        { code: '2948', name: 'Sumqayıt Regional Qİİ' },
        { code: '2949', name: 'Naxçıvan RQİİ' },
        { code: '2950', name: 'Lənkəran QİS' },
        { code: '2951', name: 'Masallı QİS' },
        { code: '2952', name: 'Mingəçevir QİS' },
        { code: '2953', name: 'Naftalan QİS' },
        { code: '2954', name: 'Neftçala QİS' },
        { code: '2955', name: 'Oğuz QİS' },
        { code: '2956', name: 'Cəlilabad QİS' },
        { code: '2957', name: 'Şirvan QİS' },
        { code: '2958', name: 'Saatlı QİS' },
        { code: '2959', name: 'Sabirabad QİS' },
        { code: '2960', name: 'Salyan QİS' },
        { code: '2961', name: 'Samux QİS' },
        { code: '2962', name: 'Siyəzən QİS' },
        { code: '2963', name: 'Sumqayıt QİS' },
        { code: '2964', name: 'Tovuz QİS' },
        { code: '2965', name: 'Tərtər QİS' },
        { code: '2966', name: 'Ucar QİS' },
        { code: '2967', name: 'Füzuli QİS' },
        { code: '2968', name: 'Göy-Göl QİS' },
        { code: '2969', name: 'Xaçmaz QİS' },
        { code: '2970', name: 'Xızı QİS' },
        { code: '2971', name: 'Şamaxı QİS' },
        { code: '2972', name: 'Şəki QİS' },
        { code: '2973', name: 'Şəmkir QİS' },
        { code: '2974', name: 'Hacıqabul QİS' },
        { code: '2975', name: 'Goranboy QİS' },
        { code: '2976', name: 'Göyçay QİS' },
        { code: '2977', name: 'Gədəbəy QİS' },
        { code: '2978', name: 'Gəncə QİS' },
        { code: '3000', name: 'Qaz Emalı Zavodu' },
        { code: '3100', name: 'Azərikimya  İB' },
        { code: '3104', name: 'Etilen - Polietilen  Zavodu' },
        { code: '3106', name: 'Təmir - tikinti İdarəsi' },
        { code: '3200', name: 'Karbamid zavodu' },
        { code: '3300', name: 'Bakı Ali Neft Məktəbi' },
        { code: '3500', name: 'Nəqliyyat idarəsi' },
        { code: '3501', name: '1 saylı TND' },
        { code: '3502', name: '2 saylı TND' },
        { code: '3503', name: '3 saylı TND' },
        { code: '3504', name: '4  saylı TND' },
        { code: '3505', name: '5 saylı TND' },
        { code: '3506', name: '6 saylı TND' },
        { code: '3700', name: 'Metanol Zavodu' },
        { code: '3900', name: 'SOCAR Petroleum' },
        { code: '4000', name: 'SOCAR Korporativ Xidmətlər' }
    ];

    /* ---- Storage locations ---- */
    const STORAGE_LOCATIONS = ['M001','M002','M003','M004','M005','M006','M007','M008','M009','M010'];

    /* ---- Base units of measure (editable) ---- */
    const UOM = ['EA','PC','M','MM','KG','G','L','ML','M2','M3','SET','ROLL','BOX','PR','TON'];

    /* ---- MRP types (item + inventory planning method) ---- */
    const MRP_TYPES = [
        { code: 'PD', desc: 'MRP' },
        { code: 'ND', desc: 'No planning' },
        { code: 'Z1', desc: 'RPM Critical' },
        { code: 'VB', desc: 'RPM Non-critical / CD&E' }
    ];

    /* ---- ABC codes (inventory categorisation) ---- */
    const ABC_CODES = [
        { code: 'R', desc: 'RPM Critical' },
        { code: 'N', desc: 'RPM Non-critical' },
        { code: 'G', desc: 'Civil Defense & Emergency (CD&E)' },
        { code: 'Z', desc: 'Spare Parts Kit (ZIP)' },
        { code: 'M', desc: 'MRP' },
        { code: 'V', desc: 'NVI' }
    ];

    /* ---- Lot-size types (MRP run) ---- */
    const LOT_SIZES = [
        { code: 'EX', desc: 'Lot-for-lot (EX)' },
        { code: 'FX', desc: 'Fixed lot size (FX)' },
        { code: 'WB', desc: 'Weekly lot size (WB)' },
        { code: 'MB', desc: 'Monthly lot size (MB)' },
        { code: 'TB', desc: 'Daily lot size (TB)' },
        { code: 'HB', desc: 'Replenish to maximum (HB)' }
    ];

    /* ---- Manufacturers (managed master data) ----
       Reference vendor catalog covering the material groups of this master
       (M001–M028). migrate() merges new names into existing states by name,
       so extending this list is safe for already-persisted data. ---- */
    const MANUFACTURERS = [
        { name: 'SKF', country: 'Sweden' },
        { name: 'NSK', country: 'Japan' },
        { name: 'FAG (Schaeffler)', country: 'Germany' },
        { name: 'ESAB', country: 'Sweden' },
        { name: 'SHTURMANN', country: 'Russia' },
        { name: 'Parker', country: 'USA' },
        { name: 'Gates', country: 'USA' },
        { name: 'Manuli', country: 'Italy' },
        // bearings & power transmission
        { name: 'Timken', country: 'USA' },
        { name: 'NTN', country: 'Japan' },
        { name: 'Koyo (JTEKT)', country: 'Japan' },
        { name: 'Continental (ContiTech)', country: 'Germany' },
        { name: 'Optibelt', country: 'Germany' },
        { name: 'Dayco', country: 'USA' },
        { name: 'Fenner', country: 'UK' },
        // hydraulics & pneumatics
        { name: 'Bosch Rexroth', country: 'Germany' },
        { name: 'Eaton', country: 'USA' },
        { name: 'Danfoss', country: 'Denmark' },
        { name: 'Festo', country: 'Germany' },
        { name: 'SMC', country: 'Japan' },
        { name: 'Norgren', country: 'UK' },
        { name: 'Bürkert', country: 'Germany' },
        // valves & pipeline fittings
        { name: 'Flowserve', country: 'USA' },
        { name: 'Cameron', country: 'USA' },
        { name: 'KITZ', country: 'Japan' },
        { name: 'Velan', country: 'Canada' },
        { name: 'Swagelok', country: 'USA' },
        { name: 'Spirax Sarco', country: 'UK' },
        { name: 'AVK', country: 'Denmark' },
        // welding
        { name: 'Lincoln Electric', country: 'USA' },
        { name: 'Kemppi', country: 'Finland' },
        { name: 'Fronius', country: 'Austria' },
        { name: 'Böhler Welding', country: 'Austria' },
        // electrical equipment & switchgear
        { name: 'Schneider Electric', country: 'France' },
        { name: 'Legrand', country: 'France' },
        { name: 'Mitsubishi Electric', country: 'Japan' },
        { name: 'General Electric', country: 'USA' },
        { name: 'Chint', country: 'China' },
        { name: 'Rittal', country: 'Germany' },
        { name: 'Weidmüller', country: 'Germany' },
        { name: 'Omron', country: 'Japan' },
        // cables & wires
        { name: 'Prysmian', country: 'Italy' },
        { name: 'Lapp', country: 'Germany' },
        { name: 'Helukabel', country: 'Germany' },
        { name: 'Belden', country: 'USA' },
        // instrumentation & automation
        { name: 'Endress+Hauser', country: 'Switzerland' },
        { name: 'Yokogawa', country: 'Japan' },
        { name: 'Honeywell', country: 'USA' },
        { name: 'WIKA', country: 'Germany' },
        { name: 'KROHNE', country: 'Germany' },
        { name: 'Pepperl+Fuchs', country: 'Germany' },
        { name: 'SICK', country: 'Germany' },
        // pumps & compressors
        { name: 'Grundfos', country: 'Denmark' },
        { name: 'KSB', country: 'Germany' },
        { name: 'Sulzer', country: 'Switzerland' },
        { name: 'Atlas Copco', country: 'Sweden' },
        { name: 'Ingersoll Rand', country: 'USA' },
        { name: 'Wilo', country: 'Germany' },
        { name: 'Ebara', country: 'Japan' },
        // motors & engines
        { name: 'WEG', country: 'Brazil' },
        { name: 'Cummins', country: 'USA' },
        { name: 'Caterpillar', country: 'USA' },
        { name: 'Perkins', country: 'UK' },
        { name: 'Deutz', country: 'Germany' },
        // oil & gas, drilling, pipes
        { name: 'NOV', country: 'USA' },
        { name: 'Baker Hughes', country: 'USA' },
        { name: 'Halliburton', country: 'USA' },
        { name: 'Weatherford', country: 'USA' },
        { name: 'Tenaris', country: 'Luxembourg' },
        { name: 'Vallourec', country: 'France' },
        { name: 'TMK', country: 'Russia' },
        { name: 'Sandvik', country: 'Sweden' },
        // lubricants & chemicals
        { name: 'Shell', country: 'Netherlands' },
        { name: 'ExxonMobil', country: 'USA' },
        { name: 'Castrol', country: 'UK' },
        { name: 'TotalEnergies', country: 'France' },
        { name: 'Fuchs', country: 'Germany' },
        { name: 'Henkel (Loctite)', country: 'Germany' },
        // sealing & rubber-technical
        { name: 'Trelleborg', country: 'Sweden' },
        { name: 'Freudenberg', country: 'Germany' },
        { name: 'Klinger', country: 'Austria' },
        { name: 'Garlock', country: 'USA' },
        { name: 'James Walker', country: 'UK' },
        // tools & fasteners
        { name: 'Bosch', country: 'Germany' },
        { name: 'Makita', country: 'Japan' },
        { name: 'DeWalt', country: 'USA' },
        { name: 'Hilti', country: 'Liechtenstein' },
        { name: 'Knipex', country: 'Germany' },
        { name: 'Bahco', country: 'Sweden' },
        { name: 'Würth', country: 'Germany' },
        // PPE & safety
        { name: '3M', country: 'USA' },
        { name: 'MSA Safety', country: 'USA' },
        { name: 'Ansell', country: 'Australia' },
        { name: 'uvex', country: 'Germany' },
        { name: 'DuPont', country: 'USA' },
        { name: 'Dräger', country: 'Germany' },
        // IT & network equipment
        { name: 'Cisco', country: 'USA' },
        { name: 'HP', country: 'USA' },
        { name: 'Dell', country: 'USA' },
        { name: 'Lenovo', country: 'China' },
        // batteries
        { name: 'VARTA', country: 'Germany' },
        { name: 'Exide', country: 'USA' },
        { name: 'Various', country: '' }
    ];

    /* ---- Users (managed by Central team) ---- */
    const USERS = [
        { id: 'u1', name: 'John Simpson', email: 'john.simpson@dmp.az', role: 'Requester', plants: ['1700', '1004', '3000'], status: 'Active' },
        { id: 'u2', name: 'Leyla Mammadova', email: 'leyla.mammadova@dmp.az', role: 'Technical SME', plants: ['1700', '3000'], status: 'Active' },
        { id: 'u3', name: 'Rashad Aliyev', email: 'rashad.aliyev@dmp.az', role: 'Accounting', plants: ['3000'], status: 'Active' },
        { id: 'u4', name: 'Nigar Huseynova', email: 'nigar.huseynova@dmp.az', role: 'MDM Specialist', plants: ['1700', '3100', '3200'], status: 'Active' },
        { id: 'u5', name: 'Elvin Qasimov', email: 'elvin.qasimov@dmp.az', role: 'Central team', plants: ['1700', '3000', '3700', '3100', '3104', '3106', '3200'], status: 'Active' },
        { id: 'u6', name: 'Aysel Karimova', email: 'aysel.karimova@dmp.az', role: 'Inventory team', plants: ['1700'], status: 'Active' },
        { id: 'u7', name: 'Tural Aliyev', email: 'tural.aliyev@dmp.az', role: 'Department Budget Owner', plants: ['1700', '3000'], status: 'Active' }
    ];

    /* ---- Material type choices (requester picks) ---- */
    const MATERIAL_TYPE_CHOICES = ['OEM','Generic','Engineered','Commercial'];

    /* ---- Roles ---- */
    // 'Requester' doubles as the Plant Data Steward of the bulk processes;
    // 'Department Budget Owner' approves Min/Max inventory commitments (NOT
    // Accounting, and NOT the Inventory team — per the bulk-process spec)
    const ROLES = ['Requester','Technical SME','Accounting','MDM Specialist','Department Budget Owner','Central team','Inventory team'];

    /* ---- Valuation classes (Accounting) ---- */
    const VALUATION_CLASSES = [
        { code: '3000', desc: 'Raw materials' },
        { code: '3100', desc: 'Goods for resale' },
        { code: '3268', desc: 'Gas sales service' },
        { code: '3301', desc: 'CIP Inventory' },
        { code: '3400', desc: 'Repair materials' },
        { code: '7900', desc: 'WIP Petroleum Products' },
        { code: '7901', desc: 'Other WIP' },
        { code: '7920', desc: 'Crude Oil' },
        { code: '7921', desc: 'Natural Gas' },
        { code: '7922', desc: 'Finished Petroleum Products' },
        { code: '7923', desc: 'Finished Gas Products' },
        { code: '7924', desc: 'Other Finished Products' }
    ];

    /* ---- Material groups (M001..M028 with sub-codes) ---- */
    const MATERIAL_GROUPS = [
        { code: 'M001.0000', desc: 'Pipes' },
        { code: 'M001.0001', desc: 'Casing pipes' },
        { code: 'M001.0002', desc: 'Drill pipes' },
        { code: 'M001.0003', desc: 'Tubing (NKT)' },
        { code: 'M001.0004', desc: 'Oil and gas pipelines' },
        { code: 'M001.0005', desc: 'Special steel pipes' },
        { code: 'M001.0006', desc: 'Gas and water pipes' },
        { code: 'M001.0007', desc: 'Other pipes' },
        { code: 'M002.0000', desc: 'Metal products' },
        { code: 'M002.0001', desc: 'Couplings, fittings' },
        { code: 'M002.0002', desc: 'Nails, bolts, nuts, welding electrodes, steel cable, pins, etc.' },
        { code: 'M002.0003', desc: 'Ferrous rolled products (beams, channels, rebar, steel sheet)' },
        { code: 'M002.0004', desc: 'Non-ferrous metals' },
        { code: 'M002.0005', desc: 'Metal scrap' },
        { code: 'M002.0006', desc: 'Precious metals' },
        { code: 'M003.0000', desc: 'Mechanical equipment' },
        { code: 'M003.0001', desc: 'Drilling equipment' },
        { code: 'M003.0002', desc: 'Oil-field equipment' },
        { code: 'M003.0003', desc: 'Wellhead equipment' },
        { code: 'M003.0004', desc: 'Downhole equipment' },
        { code: 'M003.0005', desc: 'Oil-related instrumentation' },
        { code: 'M003.0006', desc: 'Drill bits' },
        { code: 'M003.0007', desc: 'Machine tools' },
        { code: 'M003.0008', desc: 'Firefighting equipment' },
        { code: 'M003.0009', desc: 'Heating boilers and spare parts' },
        { code: 'M003.0010', desc: 'Cleaning equipment and spare parts' },
        { code: 'M003.0011', desc: 'Hydraulic equipment and materials' },
        { code: 'M003.0012', desc: 'Anchors, anchor chains, and chain products' },
        { code: 'M003.0013', desc: 'Navigation equipment' },
        { code: 'M003.0014', desc: 'Lifting equipment and devices' },
        { code: 'M003.0015', desc: 'Diving equipment and accessories' },
        { code: 'M003.0016', desc: 'Emergency and rescue equipment' },
        { code: 'M003.0017', desc: 'Geophysical and geological installations and equipment' },
        { code: 'M003.0018', desc: 'Welding equipment' },
        { code: 'M003.0019', desc: 'Diesel engines' },
        { code: 'M003.0020', desc: 'Pumps' },
        { code: 'M003.0021', desc: 'Compressors' },
        { code: 'M003.0022', desc: 'Drilling tools' },
        { code: 'M003.0023', desc: 'Tools' },
        { code: 'M003.0024', desc: 'Tanks and tank equipment' },
        { code: 'M004.0000', desc: 'Electrical equipment' },
        { code: 'M004.0001', desc: 'Electrical devices, accessories, and materials' },
        { code: 'M004.0002', desc: 'Batteries (accumulators)' },
        { code: 'M004.0003', desc: 'Electric motors' },
        { code: 'M004.0004', desc: 'Transformers' },
        { code: 'M004.0005', desc: 'Generators' },
        { code: 'M004.0006', desc: 'Marine electrical goods' },
        { code: 'M004.0007', desc: 'Electrical switchboards' },
        { code: 'M005.0000', desc: 'Spare parts' },
        { code: 'M005.0001', desc: 'Truck spare parts' },
        { code: 'M005.0002', desc: 'Passenger-car spare parts' },
        { code: 'M005.0003', desc: 'Special-vehicle spare parts' },
        { code: 'M005.0004', desc: 'Roller bearings' },
        { code: 'M005.0005', desc: 'Diesel engine spare parts' },
        { code: 'M005.0006', desc: 'Pump and compressor spare parts' },
        { code: 'M005.0007', desc: 'Drilling and oil-field equipment spare parts' },
        { code: 'M005.0008', desc: 'Marine engine spare parts' },
        { code: 'M005.0009', desc: 'Turbines and turbine spare parts' },
        { code: 'M005.0010', desc: 'Marine propellers, blades, shafts, and spare parts' },
        { code: 'M006.0000', desc: 'Building materials' },
        { code: 'M006.0001', desc: 'Wood materials' },
        { code: 'M006.0002', desc: 'Paints and solvents' },
        { code: 'M006.0003', desc: 'Asbestos sheets, oils, and ropes' },
        { code: 'M006.0004', desc: 'Plumbing' },
        { code: 'M006.0005', desc: 'Cement, sand, gravel, expanded clay (keramzit)' },
        { code: 'M006.0006', desc: 'Reinforcement, wire (catenary)' },
        { code: 'M006.0007', desc: 'Doors, windows' },
        { code: 'M006.0008', desc: 'Roofing materials (slate, expanded clay, etc.)' },
        { code: 'M007.0000', desc: 'Pipeline fittings' },
        { code: 'M007.0001', desc: 'Flanges' },
        { code: 'M007.0002', desc: 'Gate valves and ball valves' },
        { code: 'M007.0003', desc: 'Check valves' },
        { code: 'M007.0004', desc: 'Globe valves and taps' },
        { code: 'M008.0000', desc: 'Rubber-technical products' },
        { code: 'M008.0001', desc: 'Belts' },
        { code: 'M008.0002', desc: 'Vehicle tyres' },
        { code: 'M008.0003', desc: 'Hoses (corrugated, oxygen, drilling, compressor)' },
        { code: 'M008.0004', desc: 'Paronite, technical sheeting, sealants' },
        { code: 'M009.0000', desc: 'Oil and gas products' },
        { code: 'M009.0001', desc: 'Crude oil' },
        { code: 'M009.0002', desc: 'Natural gas' },
        { code: 'M009.0003', desc: 'Gas products' },
        { code: 'M009.0004', desc: 'Petroleum products' },
        { code: 'M009.0005', desc: 'Lubricants' },
        { code: 'M009.0006', desc: 'Fuels' },
        { code: 'M010.0000', desc: 'Cables and wires' },
        { code: 'M010.0001', desc: 'Power cables' },
        { code: 'M010.0002', desc: 'Control cables' },
        { code: 'M010.0003', desc: 'Enamelled (winding) wires' },
        { code: 'M010.0004', desc: 'Bare wires, etc.' },
        { code: 'M011.0000', desc: 'Instrumentation and automation devices' },
        { code: 'M011.0001', desc: 'Measurement instruments' },
        { code: 'M011.0002', desc: 'Electronics and automation (microcircuits, transistors, capacitors)' },
        { code: 'M011.0003', desc: 'Geophysical and geological instruments' },
        { code: 'M011.0004', desc: 'Spare parts for instrumentation and automation devices' },
        { code: 'M012.0000', desc: 'Chemical reagents and elements' },
        { code: 'M013.0000', desc: 'Vehicles' },
        { code: 'M013.0001', desc: 'Passenger cars' },
        { code: 'M013.0002', desc: 'Trucks' },
        { code: 'M013.0003', desc: 'Special-purpose vehicles' },
        { code: 'M014.0000', desc: 'Personal protective and rescue equipment' },
        { code: 'M014.0001', desc: 'Civil defence' },
        { code: 'M014.0002', desc: 'Workwear' },
        { code: 'M014.0003', desc: 'Loading and unloading equipment' },
        { code: 'M015.0000', desc: 'Cultural and household goods' },
        { code: 'M015.0001', desc: 'Catering goods and equipment (kitchenware)' },
        { code: 'M015.0002', desc: 'Cultural and household equipment (AC, refrigerator, telephone, radio, etc.)' },
        { code: 'M015.0003', desc: 'Soft inventory (blankets, mattresses, fabrics, etc.)' },
        { code: 'M015.0004', desc: 'Household goods' },
        { code: 'M015.0005', desc: 'Food products' },
        { code: 'M015.0006', desc: 'Key cabinets' },
        { code: 'M015.0007', desc: 'Cabin houses' },
        { code: 'M015.0008', desc: 'Furniture' },
        { code: 'M016.0000', desc: 'Computers and office technology' },
        { code: 'M016.0001', desc: 'Spare parts and materials for computers and office technology' },
        { code: 'M016.0002', desc: 'Network equipment' },
        { code: 'M017.0000', desc: 'Laboratory equipment' },
        { code: 'M018.0000', desc: 'Weapons and ammunition' },
        { code: 'M019.0000', desc: 'Medical supplies, equipment, and pharmaceuticals' },
        { code: 'M020.0000', desc: 'Intangible assets' },
        { code: 'M021.0000', desc: 'Pyrotechnics (flares, rockets)' },
        { code: 'M022.0000', desc: 'Forms, books' },
        { code: 'M023.0000', desc: 'Paper, office supplies, stationery, posters' },
        { code: 'M024.0000', desc: 'Containers / packaging' },
        { code: 'M025.0000', desc: 'Communication equipment' },
        { code: 'M025.0001', desc: 'Radio and radio-navigation equipment, radio components' },
        { code: 'M025.0002', desc: 'Relays, contactors, electrical brushes, fuses, microcircuits' },
        { code: 'M025.0003', desc: 'Communication installations and transmission equipment' },
        { code: 'M026.0000', desc: 'Sports equipment' },
        { code: 'M027.0000', desc: 'Printing-house equipment' },
        { code: 'M027.0001', desc: 'Equipment used in polygraphy and printing houses' },
        { code: 'M028.0000', desc: 'Other / miscellaneous' }
    ];

    /* ---- Attribute field types ---- */
    const ATTR_FIELD_TYPES = ['Text', 'Number', 'Range', 'Yes/No', 'List', 'Date'];

    /* ---- Category attribute catalog: UNSPSC → structured attribute schema.
       Each attribute: { name, uom, mandatory, fieldType, options? (List type) } ---- */
    const A = (name, fieldType, uom, mandatory, options) =>
        ({ name, fieldType: fieldType || 'Text', uom: uom || '', mandatory: !!mandatory, options: options || '' });

    const CATEGORY_ATTRIBUTES = [
        { unspsc: '26111801', label: 'V belts', materialGroup: 'M008.0001', attributes: [
            A('Belt profile/section', 'Text', '', true),
            A('Belt type', 'Text'),
            A('Belt properties', 'Text'),
            A('Top width', 'Number', 'MM', true),
            A('Wrapped cover', 'Yes/No'),
            A('Construction', 'Text'),
            A('Effective length (Lw/Lp)', 'Number', 'MM', true),
            A('Inner length (Li)', 'Number', 'MM'),
            A('Outer length (La)', 'Number', 'MM'),
            A('Belt body material', 'Text'),
            A('Tensile cord material', 'Text'),
            A('Sub-brand', 'Text'),
            A('Product net weight', 'Number', 'KG')
        ] },
        { unspsc: '31171504', label: 'Ball bearings', materialGroup: 'M005.0004', attributes: [
            A('Bearing type', 'Text', '', true),
            A('Row count', 'List', '', false, 'Single row, Double row'),
            A('Bore diameter', 'Number', 'MM', true),
            A('Outside diameter', 'Number', 'MM', true),
            A('Width', 'Number', 'MM', true),
            A('Seal/shield type', 'Text'),
            A('Internal clearance', 'List', '', false, 'CN, C2, C3, C4'),
            A('Cage material', 'Text')
        ] },
        { unspsc: '40141607', label: 'Gate valves', materialGroup: 'M007.0002', attributes: [
            A('Nominal size', 'Text', '', true),
            A('Pressure rating', 'Text', '', true),
            A('Body material', 'Text'),
            A('End connection', 'List', '', false, 'Flanged, Threaded, Butt-weld'),
            A('Operation', 'Text'),
            A('Bonnet type', 'Text'),
            A('Stem type', 'Text'),
            A('Standard', 'Text')
        ] },
        { unspsc: '23271807', label: 'Welding electrodes', materialGroup: 'M002.0002', attributes: [
            A('Electrode diameter', 'Number', 'MM', true),
            A('Electrode length', 'Number', 'MM'),
            A('AWS classification', 'Text', '', true),
            A('Coating', 'Text'),
            A('Current type', 'List', '', false, 'DC+, DC-, AC, AC/DC'),
            A('Packaging', 'Text'),
            A('Alloy composition', 'Text'),
            A('Welding position', 'Text')
        ] },
        { unspsc: '26121636', label: 'Patch cords', materialGroup: 'M010.0002', attributes: [
            A('Category', 'List', '', true, 'CAT5e, CAT6, CAT6a, CAT7'),
            A('Shielding', 'List', '', false, 'UTP, FTP, SFTP'),
            A('Length', 'Number', 'M', true),
            A('Conductor', 'Text'),
            A('Insulation', 'Text'),
            A('Connector type', 'Text'),
            A('Conductor gauge', 'Text'),
            A('Jacket colour', 'Text')
        ] }
    ];

    /* ---- Item images: inline SVG placeholders (offline-safe, no network).
       Shown until the user uploads a real photo for the item. ---- */
    function ph(label, emoji) {
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='260'>
            <rect width='300' height='260' fill='#F4F5F3'/>
            <text x='150' y='128' font-size='72' text-anchor='middle' dominant-baseline='middle'>${emoji}</text>
            <text x='150' y='196' font-size='16' fill='#8a8f88' font-family='Helvetica,Arial' text-anchor='middle'>${label}</text>
        </svg>`;
        return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    }
    const SPEC10_IMG = {
        mat_s10_434556: ph('Control cable', '🔌'),
        mat_s10_336384: ph('V-belt', '⚙️'),
        mat_s10_486993: ph('Ball bearing', '⚫'),
        mat_s10_404804: ph('Connector', '🔗'),
        mat_s10_397018: ph('Tapered bearing', '⚫'),
        mat_s10_329146: ph('Circuit breaker', '⚡'),
        mat_s10_569535: ph('MCB', '⚡'),
        mat_s10_302202: ph('Power supply', '🔋'),
        mat_s10_423333: ph('Solenoid valve', '🛠️'),
        mat_s10_437740: ph('Power cable', '🔌')
    };

    function build() {
        const uid = window.Store ? window.Store.uid : ((p) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 8));
        // fold in the Spec10 pipeline batch (extra catalog categories, materials, manufacturers)
        const sp = window.SPEC10 ? JSON.parse(JSON.stringify(window.SPEC10)) : {};
        (sp.materials || []).forEach(m => { if (!m.image && SPEC10_IMG[m.id]) m.image = SPEC10_IMG[m.id]; });
        const cats = CATEGORY_ATTRIBUTES.concat((sp.categories || []).filter(c => !CATEGORY_ATTRIBUTES.some(x => x.unspsc === c.unspsc)));
        const manu = MANUFACTURERS.concat((sp.manufacturers || []).filter(m => !MANUFACTURERS.some(x => x.name === m.name)));
        return {
            session: {
                currentRole: 'Requester',
                currentUser: 'John Simpson',
                company: 'Delta Drilling LTD.',
                plant: '1700'                      // requester's home plant
            },
            datasets: {
                PLANTS, STORAGE_LOCATIONS, UOM, MRP_TYPES, ABC_CODES, LOT_SIZES,
                MATERIAL_TYPE_CHOICES, ROLES, VALUATION_CLASSES, MATERIAL_GROUPS,
                CATEGORY_ATTRIBUTES: cats, ATTR_FIELD_TYPES, MANUFACTURERS: manu
            },
            materials: sp.materials || [],
            requests: [],
            bulkBatches: [],
            users: USERS.map(u => Object.assign({}, u)),
            notifications: [
                { id: uid('ntf'), read: false, ts: Date.now() - 3600e3,
                  title: 'Welcome to Demand Planning', body: 'Search the material master or start a new item request.', kind: 'info' }
            ],
            cart: []
        };
    }

    window.Seed = { build, PLANTS, STORAGE_LOCATIONS, UOM, MRP_TYPES, ABC_CODES, LOT_SIZES, MATERIAL_TYPE_CHOICES, ROLES, VALUATION_CLASSES, MATERIAL_GROUPS, CATEGORY_ATTRIBUTES, ATTR_FIELD_TYPES, MANUFACTURERS, USERS };
})();
