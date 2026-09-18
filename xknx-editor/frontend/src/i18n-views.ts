/**
 * View strings (everything outside the shell). English is the key; missing keys fall back to it.
 * Keep the two tables aligned: every NL key should also be in DE.
 */

export const VIEWS_NL: Record<string, string> = {
  "Back up catalog and settings…": "Catalogus en instellingen back-uppen…",
  "Restore from backup…": "Terugzetten uit back-up…",
  "Back up catalog and settings": "Catalogus en instellingen back-uppen",
  "Restore from backup": "Terugzetten uit back-up",
  "Everything under /config that is not a project, in one archive: the imported product data, the document library, the gateway settings, the keys, and the decrypted project logs. Projects are backed up with Save a copy.":
    "Alles onder /config dat geen project is, in één archief: de geïmporteerde productdata, de documentenbibliotheek, de gateway-instellingen, de sleutels en de ontsleutelde projectlogboeken. Projecten back-up je met Kopie opslaan.",
  "With Settings and Keys included, the archive holds the signing key, the project log key and the keyring password in plain form. Treat it like a password file.":
    "Met Instellingen en Sleutels erbij bevat het archief de ondertekeningssleutel, de projectlogboeksleutel en het sleutelringwachtwoord in leesbare vorm. Behandel het als een wachtwoordbestand.",
  "Product data (catalog)": "Productdata (catalogus)",
  "Gateway settings": "Gateway-instellingen",
  Keys: "Sleutels",
  "Project logs": "Projectlogboeken",
  Written: "Geschreven",
  "Back up": "Back-uppen",
  "Backup written": "Back-up geschreven",
  "Restoring adds what is in the archive; it never deletes anything already here. Product data is re-imported, so restoring an older backup over a newer catalog only fills gaps.":
    "Terugzetten voegt toe wat in het archief zit; het verwijdert nooit iets dat er al is. Productdata wordt opnieuw geïmporteerd, dus een oudere back-up over een nieuwere catalogus vult alleen gaten.",
  "Backup file on /share": "Back-upbestand op /share",
  "Pick a backup": "Kies een back-up",
  Choose: "Kiezen",
  Restore: "Terugzetten",
  Restored: "Teruggezet",
  "Show all": "Alles tonen",
  "Drag onto Devices, Topology or a room to add it to the project":
    "Sleep naar Apparaten, Topologie of een ruimte om het aan het project toe te voegen",
  "products local": "producten lokaal",
  "No room": "Geen ruimte",
  "Drag onto a room in the Buildings dock to assign it":
    "Sleep naar een ruimte in het Gebouwen-paneel om hem toe te wijzen",
  "No key stored.": "Geen sleutel opgeslagen.",
  "Without it the log can only be read from a file decrypted elsewhere and imported in the Project dock.":
    "Zonder sleutel is het logboek alleen te lezen uit een elders ontsleuteld bestand dat in het Project-paneel is geïmporteerd.",
  "Search manufacturer, product, order number or application":
    "Zoek fabrikant, product, bestelnummer of applicatie",
  "From /share": "Uit /share",
  "Import product data": "Productdata importeren",
  Version: "Versie",
  "Available from the KNX online catalog; not imported yet":
    "Beschikbaar in de KNX-onlinecatalogus; nog niet geïmporteerd",
  "Fetch every manufacturer's product list from the KNX server once (a few minutes); afterwards the search covers every brand":
    "Haal de productlijst van elke fabrikant één keer op bij de KNX-server (een paar minuten); daarna doorzoekt het zoekveld alle merken",
  manufacturers: "fabrikanten",
  "application programs": "applicatieprogramma's",
  products: "producten",
  online: "online",
  "An application program is the configuration program a device runs; one product ships one, and several products can share the same one.":
    "Een applicatieprogramma is het configuratieprogramma dat een apparaat draait; elk product levert er één, en meerdere producten kunnen hetzelfde programma delen.",
  "Nothing matches. Clear the filter, pick a manufacturer, or press Download to fetch the product lists from the KNX server.":
    "Niets gevonden. Wis het filter, kies een fabrikant, of druk op Downloaden om de productlijsten bij de KNX-server op te halen.",
  "The catalog is empty. Import a .knxprod from the manufacturer, or press Download to fetch the product lists from the KNX server.":
    "De catalogus is leeg. Importeer een .knxprod van de fabrikant, of druk op Downloaden om de productlijsten bij de KNX-server op te halen.",
  Start: "Starten",
  Stop: "Stoppen",
  stopped: "gestopt",
  "new since": "nieuw sindsdien",
  "Bus load": "Buslast",
  Segment: "Segment",
  devices: "apparaten",
  "not counted": "niet meegeteld",
  "no power supply in the project": "geen voeding in het project",
  "No product data in the catalog for these devices, so their draw is not counted.":
    "Geen productdata in de catalogus voor deze apparaten, dus hun verbruik telt niet mee.",
  "Every log comment is encrypted with AES-256 under a key compiled into the commissioning tool itself, the same on every installation. The add-on does not ship that key. Store it once under Help → Project log key and the log reads here directly, including entries written back for import.":
    "Elke logopmerking is versleuteld met AES-256 onder een sleutel die in het inbedrijfstellingsprogramma zelf zit, op elke installatie dezelfde. De add-on levert die sleutel niet mee. Sla hem één keer op via Help → Projectlogboeksleutel; daarna is het logboek hier gewoon leesbaar, ook regels die worden teruggeschreven.",
  "Without the key, decrypt the log on the PC that wrote it and import the result here instead:":
    "Zonder de sleutel: ontsleutel het logboek op de pc die het schreef en importeer het resultaat hier:",
  "Decrypt it there, then put project-log.json on the share and pick it below.":
    "Ontsleutel het daar, zet project-log.json op de share en kies het hieronder.",
  "Project log key": "Projectlogboeksleutel",
  "Every comment in a project's log is encrypted. The key is a constant inside the commissioning tool itself, the same on every installation, so the add-on does not ship it. Extract it once from your own installation and paste the lines below. It is stored under /config only. With the key present the log reads normally, and entries the add-on writes stay readable when the project goes back.":
    "Elke opmerking in het projectlogboek is versleuteld. De sleutel is een constante in het inbedrijfstellingsprogramma zelf, op elke installatie dezelfde, dus de add-on levert hem niet mee. Haal hem één keer uit je eigen installatie en plak de regels hieronder. Hij wordt alleen onder /config bewaard. Met de sleutel is het logboek gewoon leesbaar, en blijven regels die de add-on schrijft leesbaar zodra het project teruggaat.",
  "Key stored": "Sleutel opgeslagen",
  "Adjust the folder if needed, run the line, and copy the key=, iv= and marker= lines:":
    "Pas zo nodig de map aan, voer de regel uit en kopieer de regels key=, iv= en marker=:",
  "Key (key= / iv= / marker= lines)": "Sleutel (regels key= / iv= / marker=)",
  "Remove key": "Sleutel verwijderen",
  "Project log key stored": "Projectlogboeksleutel opgeslagen",
  "Project log key removed": "Projectlogboeksleutel verwijderd",
  "Download the encrypted entries:": "Download de versleutelde regels:",
  "entries imported": "regels geïmporteerd",
  matched: "gekoppeld",
  "Log import…": "Logboek importeren…",
  "Read the log…": "Logboek lezen…",
  "Put project-log.json on the share and pick it below, or paste its contents.":
    "Zet project-log.json op de share en kies het hieronder.",
  "File on /share": "Bestand op /share",
  Import: "Importeren",
  Imported: "Geïmporteerd",
  "Remove import": "Import verwijderen",
  "Try key derivations anyway": "Toch sleutelafleidingen proberen",
  "Give the path of the JSON file produced by the script.":
    "Geef het pad van het JSON-bestand dat het script heeft gemaakt.",
  "entries imported.": "regels geïmporteerd.",
  "Import removed.": "Import verwijderd.",
  "comments are encrypted": "opmerkingen zijn versleuteld",
  "Use area.line.device, for example 1.1.5":
    "Gebruik gebied.lijn.apparaat, bijvoorbeeld 1.1.5",
  "Area must be 0-15": "Gebied moet 0-15 zijn",
  "Line must be 0-15": "Lijn moet 0-15 zijn",
  "Device must be 0-255": "Apparaat moet 0-255 zijn",
  Documents: "Documenten",
  "Upload documents": "Documenten uploaden",
  "document(s) uploaded": "document(en) geüpload",
  Tag: "Label",
  Size: "Grootte",
  Uploaded: "Geüpload",
  "Open in a new tab": "In nieuw tabblad openen",
  "No documents yet.": "Nog geen documenten.",
  "No documents for this device yet. Upload its manual or datasheet.":
    "Nog geen documenten voor dit apparaat. Upload de handleiding of het datablad.",
  "Tag (e.g. order number or device)": "Label (bijv. bestelnummer of apparaat)",
  "Upload manuals, datasheets and drawings (PDF, images, spreadsheets, .vd files) and open them later from the add-on. Files are stored under /config/docs. Tag a document with an order number so it shows up on that device.":
    "Upload handleidingen, databladen en tekeningen (PDF, afbeeldingen, spreadsheets, .vd-bestanden) en open ze later vanuit de add-on. Bestanden staan onder /config/docs. Label een document met een bestelnummer zodat het bij dat apparaat verschijnt.",
  Delete: "Verwijderen",
  "no project open, names and values need one":
    "geen project geopend; namen en waarden hebben er een nodig",
  decoding: "decodeert",
  "from objects": "via objecten",
  "Group addresses whose datapoint type is known; set the DPT of an address in the Group addresses tab to decode it":
    "Groepsadressen met bekend datapunttype; stel het DPT van een adres in op het tabblad Groepsadressen om het te decoderen",
  "This group address has no datapoint type in the project":
    "Dit groepsadres heeft geen datapunttype in het project",
  "no DPT": "geen DPT",
  "Stored; leave empty to keep it": "Opgeslagen; leeg laten om te behouden",
  "A password is stored. Type a new one to replace it; the stored one is never sent to the browser.":
    "Er is een wachtwoord opgeslagen. Typ een nieuw wachtwoord om het te vervangen; het opgeslagen wachtwoord wordt nooit naar de browser gestuurd.",
  "Try to decrypt…": "Proberen te ontsleutelen…",
  "last download": "laatste download",
  "Add to project": "Aan project toevoegen",
  "Automatic (first in keyring)": "Automatisch (eerste in sleutelring)",
  "Browse /share": "Bladeren in /share",
  Building: "Gebouw",
  "Building parts": "Gebouwdelen",
  "Connect to a KNX gateway first (top right).":
    "Verbind eerst met een KNX-gateway (rechtsboven).",
  "Datapoint types differ": "Datapunttypes verschillen",
  Date: "Datum",
  "Device labels for the distribution board: address, name, order number, manufacturer, description and room as CSV (all devices when none are selected).":
    "Apparaatlabels voor de verdeler: adres, naam, bestelnummer, fabrikant, omschrijving en ruimte als CSV (alle apparaten als er niets is geselecteerd).",
  "Duplicate a device several times, parameters included. Optionally rewrite the copies' names (find / replace) and create a group address for every communication object of each copy. Copies land on the same line with the next free addresses.":
    "Dupliceer een apparaat meerdere keren, inclusief parameters. Herschrijf optioneel de namen van de kopieën (zoeken / vervangen) en maak voor elk communicatieobject van elke kopie een groepsadres aan. Kopieën komen op dezelfde lijn met de eerstvolgende vrije adressen.",
  "project/14 (older)": "project/14 (older)",
  "project/20 (recommended)": "project/20 (aanbevolen)",
  "project/22": "project/22",
  "project/23": "project/23",
  Free: "Vrij",
  Functions: "Functies",
  identical: "identiek",
  "Import from /share": "Importeren uit /share",
  Key: "Sleutel",
  "New building": "Nieuw gebouw",
  "No devices on this area yet.": "Nog geen apparaten in dit gebied.",
  "No devices on this line yet.": "Nog geen apparaten op deze lijn.",
  "No keyring configured. Open the gateway menu (top right) → Settings, upload your .knxkeys export and enter its password. The keyring is what makes IP Secure tunnelling and Data Secure programming possible.":
    "Geen sleutelring ingesteld. Open het gatewaymenu (rechtsboven) → Instellingen, upload je export (.knxkeys) en voer het wachtwoord in. De sleutelring maakt IP Secure-tunnels en Data Secure-programmering mogelijk.",
  "No product in the catalog matches this filter. Clear it to see everything, or download the product from the online catalog below.":
    "Geen product in de catalogus komt overeen met dit filter. Wis het om alles te zien, of download het product hieronder uit de onlinecatalogus.",
  Off: "Uit",
  On: "Aan",
  "Open, create or import a project (File menu).":
    "Open, maak of importeer een project (menu Bestand).",
  Raw: "Ruw",
  Read: "Lezen",
  "Read mask, application, serial number and error state from the device":
    "Masker, applicatie, serienummer en foutstatus uit het apparaat lezen",
  "Read the device and show every byte a download would change, without writing":
    "Het apparaat lezen en elke byte tonen die een download zou wijzigen, zonder te schrijven",
  "Rebuild a project from what is on the bus: scan a range of individual addresses, match each device's application against the catalog, read its group-address, association and parameter tables back (read-only), optionally verify the result against the device, and write the devices into the open project or a new one. Devices whose product data is missing need their .knxprod in the catalog first (Catalog tab), then use Re-identify.":
    "Bouw een project opnieuw op vanaf de bus: scan een bereik fysieke adressen, koppel de applicatie van elk apparaat aan de catalogus, lees de groepsadres-, associatie- en parametertabellen terug (alleen lezen), verifieer het resultaat eventueel tegen het apparaat en schrijf de apparaten in het geopende of een nieuw project. Apparaten zonder productgegevens hebben eerst hun .knxprod in de catalogus nodig (tabblad Catalogus), daarna Opnieuw identificeren.",
  "Remove group address": "Groepsadres verwijderen",
  "Restart the device": "Het apparaat herstarten",
  Save: "Opslaan",
  "This application has no memory segments to program (property based or none).":
    "Deze applicatie heeft geen geheugensegmenten om te programmeren (op eigenschappen gebaseerd of geen).",
  "Three level (1/2/3)": "Drie niveaus (1/2/3)",
  Time: "Tijd",
  "Two level (1/2)": "Twee niveaus (1/2)",
  Upload: "Uploaden",
  "Upload .knxprod": ".knxprod uploaden",
  "Write the configuration to the device":
    "De configuratie naar het apparaat schrijven",
  "Write this address into a device in programming mode (press its programming button first)":
    "Dit adres in een apparaat in programmeermodus schrijven (druk eerst op de programmeerknop)",
  Writes: "Schrijft",
  "into a device on the bus. Either press the programming button of exactly one device (its LED lights up) and leave the serial number empty, or enter the device's 6-byte serial number (printed on the device, e.g. 00 12 34 56 78 9A) to address it without programming mode.":
    "in een apparaat op de bus. Druk op de programmeerknop van precies één apparaat (de led gaat branden) en laat het serienummer leeg, of voer het 6-byte serienummer van het apparaat in (op het apparaat gedrukt, bijv. 00 12 34 56 78 9A) om het zonder programmeermodus aan te spreken.",
  "Tool version": "Toolversie",
  "Schema version": "Schemaversie",
  "Last modified": "Laatst gewijzigd",
  "Project ID": "Project-ID",
  File: "Bestand",
  "Full download": "Volledige download",
  "Partial: parameters": "Gedeeltelijk: parameters",
  "Partial: group communication": "Gedeeltelijk: groepscommunicatie",
  Unload: "Ontladen",
  "individual address": "fysiek adres",
  "application program": "applicatieprogramma",
  parameters: "parameters",
  "communication part": "communicatiedeel",
  "Pick devices on the left; their communication objects appear on the right. Choose a target group address per object, let the editor pair them by name (the datapoint type must agree), or assign existing addresses sequentially from a start address. Objects without a link yet get the address as their sending address.":
    "Kies links apparaten; hun communicatieobjecten verschijnen rechts. Kies per object een doelgroepsadres, laat de editor ze op naam koppelen (het datapunttype moet overeenkomen) of wijs bestaande adressen opeenvolgend toe vanaf een startadres. Objecten zonder koppeling krijgen het adres als zendend adres.",
  "Connect two objects directly (a push button to an actuator channel, say): the editor creates a group address, gives it the sending object's datapoint type and links both. Leave the address empty for the first free one; the name defaults to the sending object's name.":
    "Verbind twee objecten rechtstreeks (bijvoorbeeld een drukknop met een actorkanaal): de editor maakt een groepsadres aan, geeft het het datapunttype van het zendende object en koppelt beide. Laat het adres leeg voor het eerste vrije; de naam is standaard die van het zendende object.",
  "Replace a device by a copy of another project device (for example a newer application version or a different model) while keeping its name, address, room and group-address links. Objects are matched by number and size; unmatched links are reported.":
    "Vervang een apparaat door een kopie van een ander projectapparaat (bijvoorbeeld een nieuwere applicatieversie of een ander model) met behoud van naam, adres, ruimte en groepsadreskoppelingen. Objecten worden op nummer en grootte gekoppeld; niet-gekoppelde koppelingen worden gemeld.",
  "Move a block of devices to other addresses on their line by adding an offset to the device number (e.g. +10 turns 1.1.5 into 1.1.15). The whole result is checked for range and collisions first; with a conflict nothing is written.":
    "Verplaats een blok apparaten naar andere adressen op hun lijn door een verschuiving bij het apparaatnummer op te tellen (bijv. +10 maakt van 1.1.5 1.1.15). Het hele resultaat wordt eerst op bereik en botsingen gecontroleerd; bij een conflict wordt niets geschreven.",
  "MDT DALI Control gateway: read the DALI bus (ballasts, groups), identify a ballast by blinking it, and run a new or post installation. Installation actions renumber ballasts on the DALI bus; start every session with a read-only scan. Manufacturer specific; verified on few devices.":
    "MDT DALI Control-gateway: lees de DALI-bus (voorschakelapparaten, groepen), identificeer een voorschakelapparaat door het te laten knipperen en voer een nieuwe of na-installatie uit. Installatieacties hernummeren de voorschakelapparaten op de DALI-bus; begin elke sessie met een scan (alleen lezen). Fabrikantspecifiek; op weinig apparaten geverifieerd.",
  "The KNX Data Secure keyring the add-on uses for IP Secure tunnels and secure device programming. Keys are masked; reveal them only on a trusted screen. A converted copy under another password can be handed to another tool or installer.":
    "De KNX Data Secure-sleutelring die de add-on gebruikt voor IP Secure-tunnels en beveiligd programmeren. Sleutels zijn gemaskeerd; toon ze alleen op een vertrouwd scherm. Een geconverteerde kopie onder een ander wachtwoord kan aan een andere tool of installateur worden gegeven.",
  Abort: "Afbreken",
  "Add a device from the catalog": "Apparaat uit de catalogus toevoegen",
  "add an address": "adres toevoegen",
  "Add child space": "Onderliggende ruimte toevoegen",
  Address: "Adres",
  "Address (auto)": "Adres (automatisch)",
  Alarm: "Alarm",
  "All off": "Alles uit",
  "All on": "Alles aan",
  Application: "Applicatie",
  "Application program": "Applicatieprogramma",
  "Application program loaded": "Applicatieprogramma geladen",
  "Application version": "Applicatieversie",
  Assign: "Toewijzen",
  "Assign address": "Adres toewijzen",
  "Assign individual address": "Fysiek adres toewijzen",
  "Assign sequentially": "Opeenvolgend toewijzen",
  Authentication: "Authenticatie",
  "Auto-pair all": "Alles automatisch koppelen",
  "Auto-pair empty": "Lege automatisch koppelen",
  "Backbone key": "Backbone-sleutel",
  Becomes: "Wordt",
  Blink: "Knipperen",
  Cancel: "Annuleren",
  "Channel 1": "Kanaal 1",
  "Channel 2": "Kanaal 2",
  Check: "Controleren",
  "Check every device for a missing, malformed or duplicate individual address and for missing product data. Click a finding to open the device.":
    "Controleer elk apparaat op een ontbrekend, ongeldig of dubbel fysiek adres en op ontbrekende productgegevens. Klik op een melding om het apparaat te openen.",
  "Choose keyring": "Sleutelring kiezen",
  Clear: "Wissen",
  "Click a device to open it in the Editor.":
    "Klik op een apparaat om het in de Editor te openen.",
  Close: "Sluiten",
  Comment: "Opmerking",
  Communication: "Communicatie",
  "Confirm DALI installation": "DALI-installatie bevestigen",
  "Connect a client": "Een client verbinden",
  "Connect automatically when the add-on starts":
    "Automatisch verbinden bij het starten van de add-on",
  "Connect to a KNX interface to commission the DALI bus.":
    "Verbind met een KNX-interface om de DALI-bus in bedrijf te stellen.",
  Connection: "Verbinding",
  "Connection settings": "Verbindingsinstellingen",
  "Connection settings…": "Verbindingsinstellingen…",
  Continue: "Doorgaan",
  Convert: "Converteren",
  Copies: "Kopieën",
  "Copy name": "Naam van kopie",
  "Copy to clipboard": "Naar klembord kopiëren",
  Copy: "Kopiëren",
  Create: "Aanmaken",
  "Create group addresses for every copy":
    "Groepsadressen voor elke kopie aanmaken",
  "Create project and add": "Project aanmaken en toevoegen",
  "Created by": "Gemaakt door",
  "Created under /config/projects. Area 1 / line 1 are ready for devices.":
    "Aangemaakt onder /config/projects. Gebied 1 / lijn 1 staan klaar voor apparaten.",
  "DALI bus": "DALI-bus",
  "Data type": "Datatype",
  "Decrypt project log": "Projectlogboek ontsleutelen",
  "Delete group and its addresses": "Groep en adressen verwijderen",
  Description: "Omschrijving",
  Destination: "Bestemming",
  Device: "Apparaat",
  "Device added": "Apparaat toegevoegd",
  "Device programmed": "Apparaat geprogrammeerd",
  "Device to replace": "Te vervangen apparaat",
  Devices: "Apparaten",
  "Devices without a room": "Apparaten zonder ruimte",
  Disconnect: "Verbinding verbreken",
  Download: "Download",
  "Download every manufacturer's product list once (a few minutes); afterwards the search box covers all brands":
    "Download eenmalig de productlijst van elke fabrikant (enkele minuten); daarna zoekt het zoekvak in alle merken",
  "Download required": "Download vereist",
  "e.g. DPST-1-1, 9.001, temperature": "bijv. DPST-1-1, 9.001, temperatuur",
  encrypted: "versleuteld",
  "Error state": "Foutstatus",
  "ECG number": "EVG-nummer",
  "Every device has a valid, unique address.":
    "Elk apparaat heeft een geldig, uniek adres.",
  "Every edit is written to the project file immediately, so this is for backups or for moving the project to another Home Assistant. Paths under /share are visible from the network share.":
    "Elke wijziging wordt direct in het projectbestand geschreven; dit is voor back-ups of om het project naar een andere Home Assistant te verplaatsen. Paden onder /share zijn zichtbaar via de netwerkshare.",
  "Experimental software. Not affiliated with the KNX Association.":
    "Experimentele software. Niet verbonden aan de KNX Association.",
  Export: "Exporteren",
  "Export project": "Project exporteren",
  "Extended copy": "Uitgebreid kopiëren",
  "Extract the key on the Windows PC (PowerShell)":
    "De sleutel uitlezen op de Windows-pc (PowerShell)",
  Filter: "Filter",
  "Filter devices": "Apparaten filteren",
  "Filter devices (name, address, product)":
    "Apparaten filteren (naam, adres, product)",
  "Filter parameters…": "Parameters filteren…",
  "Find in name": "Zoeken in naam",
  Firmware: "Firmware",
  Format: "Formaat",
  "Gateway IP": "Gateway-IP",
  "Gateways on the network": "Gateways in het netwerk",
  "Genuine key set": "Echte sleutel ingesteld",
  Group: "Groep",
  "Group address": "Groepsadres",
  "Group address style": "Groepsadresstijl",
  "Group addresses": "Groepsadressen",
  "Group communication loaded": "Groepscommunicatie geladen",
  "Group monitor": "Groepsmonitor",
  "Group objects": "Groepsobjecten",
  Hardware: "Hardware",
  "Hardware type": "Hardwaretype",
  "Home Assistant's integration usually occupies the first user in the keyring; pick another one for the editor.":
    "De Home Assistant-integratie gebruikt meestal de eerste gebruiker uit de sleutelring; kies een andere voor de editor.",
  "Home Assistant's KNX integration usually holds one tunnel on your gateway. If the gateway has a single tunnel slot, disconnect the integration first or use routing. Stored in /config/settings.json.":
    "De KNX-integratie van Home Assistant houdt meestal één tunnel op je gateway bezet. Heeft de gateway maar één tunnel, verbreek dan eerst de integratie of gebruik routing. Opgeslagen in /config/settings.json.",
  "Import .knxprod": ".knxprod importeren",
  "Import project": "Project importeren",
  "Individual address": "Fysiek adres",
  "Individual address loaded": "Fysiek adres geladen",
  Interfaces: "Interfaces",
  "Key (MOD= / EXP= / D= lines, or hex)":
    "Sleutel (regels MOD= / EXP= / D=, of hex)",
  "Keyring (.knxkeys) for IP Secure": "Sleutelring (.knxkeys) voor IP Secure",
  "Keyring password (set when the keyring was exported)":
    "Sleutelringwachtwoord (ingesteld bij het exporteren)",
  "KNX online catalog": "KNX-onlinecatalogus",
  Labels: "Labels",
  Length: "Lengte",
  Licence: "Licentie",
  Link: "Koppelen",
  "Link a group address": "Een groepsadres koppelen",
  "Link as sending": "Koppelen als zendend",
  "Link mapping": "Koppelingen",
  "Linked to": "Gekoppeld aan",
  "Linked with": "Gekoppeld met",
  Links: "Koppelingen",
  "Load manufacturers": "Fabrikanten laden",
  Loaded: "Geladen",
  "Loading…": "Laden…",
  "Long address": "Lang adres",
  "Make sending": "Zendend maken",
  "make sending": "zendend maken",
  "Management password": "Beheerwachtwoord",
  Manufacturer: "Fabrikant",
  "Manufacturer (type to search; empty = all)":
    "Fabrikant (typ om te zoeken; leeg = alle)",
  "Mask version": "Maskerversie",
  Medium: "Medium",
  "Memory preview": "Geheugenvoorbeeld",
  "Multicast group (routing)": "Multicastgroep (routing)",
  "Needs attention only": "Alleen aandacht nodig",
  "needs a manufacturer plug-in": "vereist fabrikant-plug-in",
  "New address in this group": "Nieuw adres in deze groep",
  "New group address (next free)": "Nieuw groepsadres (eerstvolgende vrije)",
  "New installation…": "Nieuwe installatie…",
  "New keyring password": "Nieuw sleutelringwachtwoord",
  "New main group": "Nieuwe hoofdgroep",
  "New middle group": "Nieuwe middengroep",
  "New pair": "Nieuw paar",
  "New project": "Nieuw project",
  "New project name": "Naam nieuw project",
  "New space": "Nieuwe ruimte",
  "No building functions here.": "Geen gebouwfuncties hier.",
  "No buildings yet.": "Nog geen gebouwen.",
  "No devices in this space. Assign devices from the Buildings tab or a device's editor.":
    "Geen apparaten in deze ruimte. Wijs apparaten toe via het tabblad Gebouwen of de editor van een apparaat.",
  "No devices yet.": "Nog geen apparaten.",
  "No edits yet. Every change can be undone here.":
    "Nog geen wijzigingen. Elke wijziging kan hier ongedaan worden gemaakt.",
  "No findings. The project looks consistent.":
    "Geen meldingen. Het project ziet er consistent uit.",
  "No group addresses yet. Create a main group, then addresses inside it.":
    "Nog geen groepsadressen. Maak een hoofdgroep en daarna adressen daarin.",
  "No KNX/IP gateways answered the search":
    "Geen KNX/IP-gateways hebben op de zoekopdracht geantwoord",
  "No objects. Select a device with product data on the left.":
    "Geen objecten. Kies links een apparaat met productgegevens.",
  "No project open.": "Geen project geopend.",
  "No sub-spaces.": "Geen onderliggende ruimtes.",
  "None found yet": "Nog niets gevonden",
  "Not assigned to a room": "Niet aan een ruimte toegewezen",
  "not in catalog": "niet in catalogus",
  "Not linked to any group object. Link it from a device's Group objects tab.":
    "Aan geen enkel groepsobject gekoppeld. Koppel het via het tabblad Groepsobjecten van een apparaat.",
  Number: "Nummer",
  Object: "Object",
  "Object function": "Objectfunctie",
  "Object ↔ object": "Object ↔ object",
  "Objects → group addresses": "Objecten → groepsadressen",
  Offset: "Verschuiving",
  "Open a project first.": "Open eerst een project.",
  "Open a project to see its topology.":
    "Open een project om de topologie te zien.",
  "Open project": "Project openen",
  "Order info": "Bestelinfo",
  "Order number": "Bestelnummer",
  "Overwrite if it exists": "Overschrijven als het bestaat",
  "Own individual address (optional)": "Eigen fysiek adres (optioneel)",
  Package: "Pakket",
  "Pairs to create": "Aan te maken paren",
  Parameters: "Parameters",
  "Parameters loaded": "Parameters geladen",
  Password: "Wachtwoord",
  Pause: "Pauze",
  "Pick a device": "Kies een apparaat",
  "Placeholder key in use": "Tijdelijke sleutel in gebruik",
  "Post installation…": "Na-installatie…",
  "Preview memory": "Geheugen bekijken",
  Priority: "Prioriteit",
  Product: "Product",
  "Product ref": "Productreferentie",
  Program: "Programmeren",
  "Program device": "Apparaat programmeren",
  "Program ref": "Programmareferentie",
  "Programming mode": "Programmeermodus",
  Project: "Project",
  "Project imported": "Project geïmporteerd",
  "Project password": "Projectwachtwoord",
  "Project password (leave empty if the export is not protected)":
    "Projectwachtwoord (leeg laten als de export niet beveiligd is)",
  Property: "Eigenschap",
  "Re-identify": "Opnieuw identificeren",
  "Read back": "Uitlezen",
  "Read from device": "Uit apparaat lezen",
  Receiving: "Ontvangend",
  "Receiving object": "Ontvangend object",
  Reload: "Herladen",
  Remove: "Verwijderen",
  "Replace device": "Apparaat vervangen",
  "Replace with": "Vervangen door",
  "Replace with a copy of": "Vervangen door een kopie van",
  Reset: "Herstellen",
  "Reset to placeholder": "Terug naar tijdelijke sleutel",
  "Reset…": "Resetten…",
  Restart: "Herstarten",
  "Restart sent": "Herstart verzonden",
  "Reveal keys": "Sleutels tonen",
  "Reverted to the placeholder key": "Teruggezet naar de tijdelijke sleutel",
  "Rows with a DPT mismatch are skipped.":
    "Rijen met een afwijkend DPT worden overgeslagen.",
  "Run check": "Controle uitvoeren",
  "Run “Scan bus” to read the DALI bus.":
    "Voer “Bus scannen” uit om de DALI-bus te lezen.",
  Running: "Bezig",
  "Save a copy": "Kopie opslaan",
  "Save copy": "Kopie opslaan",
  "Save key": "Sleutel opslaan",
  Scan: "Scannen",
  "Scan again": "Opnieuw scannen",
  "Scan bus": "Bus scannen",
  "Scanning…": "Scannen…",
  "Search products": "Producten zoeken",
  "Select shown": "Getoonde selecteren",
  Sending: "Zendend",
  "Sending object": "Zendend object",
  Sequence: "Volgnummer",
  "Serial number": "Serienummer",
  "Serial number (optional)": "Serienummer (optioneel)",
  "Shift addresses": "Adressen verschuiven",
  Shift: "Verschuiven",
  "Signing key": "Ondertekeningssleutel",
  "Signing key stored": "Ondertekeningssleutel opgeslagen",
  Snapshot: "Momentopname",
  Source: "Bron",
  "Source device": "Bronapparaat",
  Space: "Ruimte",
  "Start address, e.g. 1/2/0": "Startadres, bijv. 1/2/0",
  State: "Status",
  Status: "Status",
  "Sub-spaces": "Onderliggende ruimtes",
  "Target group address": "Doelgroepsadres",
  "Test before programming": "Testen vóór programmeren",
  "The catalog is empty. Upload a .knxprod from the manufacturer, drop files into /share, or download from the online catalog below.":
    "De catalogus is leeg. Upload een .knxprod van de fabrikant, zet bestanden in /share of download hieronder uit de onlinecatalogus.",
  "The device already holds this configuration.":
    "Het apparaat bevat deze configuratie al.",
  "The KNX online catalog has no downloadable product for this program reference. Try the catalog search or upload the .knxprod from the manufacturer.":
    "De KNX-onlinecatalogus heeft geen downloadbaar product voor deze programmareferentie. Probeer de cataloguszoeker of upload de .knxprod van de fabrikant.",
  "The project has no devices yet.": "Het project heeft nog geen apparaten.",
  "Third-party licences": "Licenties van derden",
  "This group address no longer exists.": "Dit groepsadres bestaat niet meer.",
  "This space no longer exists.": "Deze ruimte bestaat niet meer.",
  "Tool key": "Toolsleutel",
  Tools: "Hulpmiddelen",
  "Topology check": "Topologiecontrole",
  Transmit: "Zenden",
  "Try project password…": "Projectwachtwoord proberen…",
  "Trying…": "Bezig…",
  "Tunnel user (IP Secure)": "Tunnelgebruiker (IP Secure)",
  Unassign: "Toewijzing opheffen",
  Unlink: "Ontkoppelen",
  "Unload the application (select scope Unload, then Program device)":
    "De applicatie ontladen (kies bereik Ontladen, daarna Apparaat programmeren)",
  Update: "Bijwerken",
  Value: "Waarde",
  "value: 0-63 or hex bytes": "waarde: 0-63 of hexbytes",
  Verify: "Verifiëren",
  "Without group": "Zonder groep",
  "Working with it": "Ermee werken",
  Write: "Schrijven",
  "Write into a project": "In een project schrijven",
  "Write to": "Schrijven naar",
  "XKNX Editor comes with no stability or safety guarantees. It writes to real KNX hardware: a failed or interrupted download can leave a device unloaded until it is reprogrammed. Do not use it on an installation you cannot afford to take offline, and keep a known-good backup of any project before opening it here.":
    "XKNX Editor biedt geen garanties voor stabiliteit of veiligheid. Het schrijft naar echte KNX-hardware: een mislukte of onderbroken download kan een apparaat ontladen achterlaten tot het opnieuw is geprogrammeerd. Gebruik het niet op een installatie die je niet kunt missen, en bewaar een goede back-up van elk project voordat je het hier opent.",
  "Add to open project": "Toevoegen aan geopend project",
  "Add pair": "Paar toevoegen",
  "Download CSV": "CSV downloaden",
  "Remove from project": "Uit project verwijderen",
  "Fetch product data online": "Productgegevens online ophalen",
  "Open catalog": "Catalogus openen",
  "No scan yet.": "Nog geen scan.",
  "No device answered in that range.":
    "Geen apparaat heeft in dat bereik geantwoord.",
  From: "Van",
  "product found": "product gevonden",
  "confirm product": "product bevestigen",
  "not programmed": "niet geprogrammeerd",
  "product data missing": "productgegevens ontbreken",
  "read back": "uitgelezen",
  error: "fout",
  "already in project": "al in project",
  "added to project": "aan project toegevoegd",
  Mask: "Masker",
  Slot: "Slot",
  Type: "Type",
  Host: "Host",
  User: "Gebruiker",
  Target: "Doel",
  Room: "Ruimte",
  Name: "Naam",
  Room_: "Ruimte",
  Live: "Live",
  Archive: "Archief",
  recording: "opnemen",
  connected: "verbonden",
  "reconnecting…": "opnieuw verbinden…",
  "not connected": "niet verbonden",
  "Filter (name, value, source…)": "Filter (naam, waarde, bron…)",
  "Address: 1/2/ shows a whole middle group, 1/2/3 one address":
    "Adres: 1/2/ toont een hele middengroep, 1/2/3 één adres",
  "Datapoint type: 9 for every 9.xxx, 9.001 for one sub-type":
    "Datapunttype: 9 voor elke 9.xxx, 9.001 voor één subtype",
  "Chart this address": "Dit adres in een grafiek",
  "Last hour": "Afgelopen uur",
  "Last 6 hours": "Afgelopen 6 uur",
  "Last 24 hours": "Afgelopen 24 uur",
  "Last 7 days": "Afgelopen 7 dagen",
  "Last 30 days": "Afgelopen 30 dagen",
  "Custom range": "Eigen bereik",
  "Source address": "Bronadres",
  All: "Alle",
  Individual: "Individueel",
  Refresh: "Vernieuwen",
  "Export the filtered archive as CSV":
    "Het gefilterde archief als CSV exporteren",
  "Recording settings": "Opname-instellingen",
  "Load more": "Meer laden",
  more: "meer",
  "Nothing recorded in this range.": "Niets opgenomen in dit bereik.",
  "Recording is off. Turn it on under the settings button to keep every telegram on disk.":
    "Opnemen staat uit. Zet het aan onder de instellingenknop om elk telegram op schijf te bewaren.",
  Recording: "Opname",
  "Every telegram the connection sees is written to /config/telegrams.db, whether the live monitor is running or not. The Archive, the Charts and the Statistics read from it.":
    "Elk telegram dat de verbinding ziet wordt naar /config/telegrams.db geschreven, of de live monitor nu loopt of niet. Het Archief, de Grafieken en de Statistieken lezen eruit.",
  "Record telegrams": "Telegrammen opnemen",
  "Keep for (days, 0 = no limit)": "Bewaren gedurende (dagen, 0 = geen limiet)",
  "Keep at most (telegrams, 0 = no limit)":
    "Maximaal bewaren (telegrammen, 0 = geen limiet)",
  Stored: "Opgeslagen",
  telegrams: "telegrammen",
  oldest: "oudste",
  newest: "nieuwste",
  "Round-the-clock recording needs the connection to come back after a restart: turn on “Connect automatically when the add-on starts” in the gateway settings.":
    "Doorlopend opnemen vereist dat de verbinding na een herstart terugkomt: zet “Automatisch verbinden bij het starten van de add-on” aan in de gateway-instellingen.",
  "Clear archive": "Archief wissen",
  "Delete every recorded telegram? This cannot be undone.":
    "Alle opgenomen telegrammen verwijderen? Dit kan niet ongedaan worden gemaakt.",
  "Archive cleared": "Archief gewist",
  "Recording settings saved": "Opname-instellingen opgeslagen",
  "Show the recorded values of this address":
    "De opgenomen waarden van dit adres tonen",
  Chart: "Grafiek",
  "Add a group address (address or name)":
    "Groepsadres toevoegen (adres of naam)",
  "Open a project to pick addresses by name":
    "Open een project om adressen op naam te kiezen",
  "Up to four addresses at a time; remove one first.":
    "Maximaal vier adressen tegelijk; verwijder er eerst een.",
  Line: "Lijn",
  Steps: "Stappen",
  Area: "Vlak",
  "Pick a group address above, or press the chart button on a telegram in the group monitor or on a group address. Values come from the recorded archive; the range “Last hour” and the like keep growing live.":
    "Kies hierboven een groepsadres, of druk op de grafiekknop bij een telegram in de groepsmonitor of bij een groepsadres. De waarden komen uit het opgenomen archief; bereiken als “Afgelopen uur” groeien live mee.",
  Telegrams: "Telegrammen",
  Min: "Min",
  Max: "Max",
  Average: "Gemiddeld",
  Last: "Laatste",
  "averaged per": "gemiddeld per",
  "no numeric values in this range": "geen numerieke waarden in dit bereik",
  "No statistics yet.": "Nog geen statistieken.",
  "per minute": "per minuut",
  "busiest address": "drukste adres",
  "busiest device": "drukste apparaat",
  "Telegrams over time": "Telegrammen in de tijd",
  "Activity by weekday and hour": "Activiteit per weekdag en uur",
  "Recorder availability": "Beschikbaarheid van de opname",
  "Busiest group addresses": "Drukste groepsadressen",
  "Busiest devices": "Drukste apparaten",
  "link lost": "verbinding verbroken",
  "add-on not running": "add-on draaide niet",
  "Quiet bus while recording (nothing for more than 30 minutes):":
    "Stille bus tijdens het opnemen (langer dan 30 minuten niets):",
  Mon: "ma",
  Tue: "di",
  Wed: "wo",
  Thu: "do",
  Fri: "vr",
  Sat: "za",
  Sun: "zo",
  "Find (address or name)": "Zoeken (adres of naam)",
  "All rooms": "Alle ruimtes",
  Fit: "Passend",
  "device (colour = room)": "apparaat (kleur = ruimte)",
  "group address (colour = main group)": "groepsadres (kleur = hoofdgroep)",
  "arrow = sending object": "pijl = zendend object",
  addresses: "adressen",
  links: "koppelingen",
  "addresses without a link are not shown":
    "adressen zonder koppeling worden niet getoond",
  "Open a project to see its devices and group addresses as a network.":
    "Open een project om de apparaten en groepsadressen als netwerk te zien.",
  "Open in editor": "In editor openen",
  "Nothing numeric was recorded for these addresses in this range.":
    "Er is in dit bereik niets numerieks opgenomen voor deze adressen.",
  "No project is open, so telegrams are recorded without a datapoint type and cannot be charted. Open the project: the addresses it knows are decoded, including what was recorded before.":
    "Er is geen project open, dus telegrammen worden zonder datapunttype opgenomen en kunnen niet in een grafiek. Open het project: de adressen die het kent worden ontcijferd, ook wat eerder is opgenomen.",
  "These addresses have no datapoint type in the project. Set it in the Group addresses tab and the recorded telegrams are decoded.":
    "Deze adressen hebben geen datapunttype in het project. Stel dat in bij Groepsadressen; daarna worden de opgenomen telegrammen ontcijferd.",
  "Find manual": "Handleiding zoeken",
  "No manual found; opened a web search for this device instead":
    "Geen handleiding gevonden; in plaats daarvan een webzoekopdracht voor dit apparaat geopend",
  "Remove device from project": "Apparaat uit project verwijderen",
  "from the project? Its parameters and links are removed with it; the bus device is not touched.":
    "uit het project verwijderen? De parameters en koppelingen gaan mee; het apparaat op de bus blijft ongemoeid.",
  "Read from the payload length, not from the project. Set the datapoint type of this address to see the real value.":
    "Afgeleid uit de lengte van de payload, niet uit het project. Stel het datapunttype van dit adres in voor de echte waarde.",
  "Looking for a device in programming mode…":
    "Zoeken naar een apparaat in programmeermodus…",
  "One device is in programming mode": "Eén apparaat staat in programmeermodus",
  "Assign writes the address into it.": "Toewijzen schrijft het adres daarin.",
  "devices are in programming mode": "apparaten staan in programmeermodus",
  "Leave exactly one, or give a serial number.":
    "Laat er precies één over, of geef een serienummer op.",
  "Waiting: press the programming button on the device (its LED lights up). Nothing is written until one device answers.":
    "Wachten: druk op de programmeerknop van het apparaat (de LED gaat branden). Er wordt niets geschreven tot één apparaat antwoordt.",
  "One device is in programming mode. It currently carries":
    "Eén apparaat staat in programmeermodus. Het heeft nu",
  "Assign writes": "Toewijzen schrijft",
  "into it, replacing that address.": "erin en vervangt dat adres.",
  "A full download also writes the individual address: if nothing answers at this address and exactly one device is in programming mode, that device is given the address first and then loaded.":
    "Een volledige download schrijft ook het fysieke adres: als er niets op dit adres antwoordt en precies één apparaat in programmeermodus staat, krijgt dat apparaat eerst het adres en wordt het daarna geladen.",
  "Search an address or a name, or type a new address like 1/2/3":
    "Zoek op adres of naam, of typ een nieuw adres zoals 1/2/3",
  "and link it": "en koppel het",
  "Nothing matches. Type a full address like 1/2/3 to create it.":
    "Niets gevonden. Typ een volledig adres zoals 1/2/3 om het aan te maken.",
  "No group addresses yet. Type one like 1/2/3 to create it.":
    "Nog geen groepsadressen. Typ er een zoals 1/2/3 om het aan te maken.",
  Overview: "Overzicht",
  "Add a group address: pick a recorded one or type an address or name":
    "Groepsadres toevoegen: kies een opgenomen adres of typ een adres of naam",
  "nothing numeric": "niets numeriek",
  "Not everything could be imported:": "Niet alles kon worden geïmporteerd:",
  "A coloured line sends; telegrams light up the address they are sent to.":
    "Een gekleurde lijn verzendt; telegrammen lichten het adres op waarnaar ze gestuurd worden.",
  "A table of all devices grouped by room, with address, name and order number.":
    "Een tabel van alle apparaten per ruimte, met adres, naam en bestelnummer.",
  "Add a device…":
    "Apparaat toevoegen…",
  "Add all with the same application":
    "Alle met dezelfde applicatie toevoegen",
  "Address unassigned":
    "Adres ingetrokken",
  "All objects":
    "Alle objecten",
  "Answered in":
    "Antwoord in",
  "Answers on the bus (Ping)":
    "Antwoordt op de bus (Ping)",
  "Ask the bus which address the device with this serial number carries":
    "Vraag de bus welk adres het apparaat met dit serienummer heeft",
  "Bytes":
    "Bytes",
  "Check that something answers at this address, and how fast":
    "Controleer of er iets antwoordt op dit adres, en hoe snel",
  "Check which devices answer on the bus (the selected ones, or all shown)":
    "Controleer welke apparaten antwoorden op de bus (de geselecteerde, of alle getoonde)",
  "Collapse all":
    "Alles inklappen",
  "Common Device Object (index 0) properties: 11 serial number, 12 manufacturer, 13 program version, 15 order info, 54 programming mode, 56 max APDU length, 78 hardware type.":
    "Veelgebruikte eigenschappen van het Device Object (index 0): 11 serienummer, 12 fabrikant, 13 programmaversie, 15 bestelinfo, 54 programmeermodus, 56 max. APDU-lengte, 78 hardwaretype.",
  "Compare":
    "Vergelijken",
  "Compare the selected devices side by side":
    "Vergelijk de geselecteerde apparaten naast elkaar",
  "Compare this device with other devices, parameter by parameter":
    "Vergelijk dit apparaat met andere apparaten, parameter voor parameter",
  "Compare…":
    "Vergelijken…",
  "Connect to a gateway (top right) to see bus traffic.":
    "Verbind met een gateway (rechtsboven) om busverkeer te zien.",
  "Connections":
    "Verbindingen",
  "Count":
    "Aantal",
  "Data to write (hex bytes)":
    "Te schrijven data (hex-bytes)",
  "Datapoint types":
    "Datapunttypen",
  "Description and notes":
    "Beschrijving en notities",
  "Device labels":
    "Apparaatetiketten",
  "Diagnostics":
    "Diagnose",
  "Differences only":
    "Alleen verschillen",
  "Direct access to the device's memory and interface-object properties, for troubleshooting. Reads are harmless; writes change the device immediately and are not part of the project.":
    "Directe toegang tot het geheugen en de interface-objecteigenschappen van het apparaat, voor probleemoplossing. Lezen is onschadelijk; schrijven wijzigt het apparaat meteen en maakt geen deel uit van het project.",
  "Expand all":
    "Alles uitklappen",
  "Export table as CSV":
    "Tabel exporteren als CSV",
  "Fields on a label":
    "Velden op een etiket",
  "Find address by serial":
    "Adres zoeken via serienummer",
  "Flags C R W T U I, then the group addresses; * marks the sending one.":
    "Vlaggen C R W T U I, daarna de groepsadressen; * markeert het zendadres.",
  "Flash the programming LED for a few seconds, to find the device in the cabinet":
    "Laat de programmeer-LED een paar seconden knipperen, om het apparaat in de kast te vinden",
  "For a partly used sheet":
    "Voor een deels gebruikt vel",
  "Formal (DPST-9-1)":
    "Formeel (DPST-9-1)",
  "Formatted in ETS; saving an edit keeps the text and drops the formatting.":
    "Opgemaakt in ETS; bij opslaan van een wijziging blijft de tekst en vervalt de opmaak.",
  "Friendly (name)":
    "Leesbaar (naam)",
  "Function":
    "Functie",
  "Holds what the project would write (Verify)":
    "Bevat wat het project zou schrijven (Verifiëren)",
  "Identify":
    "Identificeren",
  "Installation hints":
    "Installatie-aanwijzingen",
  "Legend sheet (A4 table for the distribution board door)":
    "Legendablad (A4-tabel voor de deur van de verdeelkast)",
  "Linked only":
    "Alleen gekoppeld",
  "Manufacturers":
    "Fabrikanten",
  "Memory":
    "Geheugen",
  "Memory write":
    "Geheugen schrijven",
  "No device answered with that serial number.":
    "Geen apparaat antwoordde met dat serienummer.",
  "No device is in programming mode.":
    "Geen apparaat staat in programmeermodus.",
  "No device with an address (and, to verify, product data) to check.":
    "Geen apparaat met een adres (en, om te verifiëren, productdata) om te controleren.",
  "No devices in this project.":
    "Geen apparaten in dit project.",
  "No group object differs.":
    "Geen groepsobject verschilt.",
  "No group objects in this project.":
    "Geen groepsobjecten in dit project.",
  "No parameter differs.":
    "Geen parameter verschilt.",
  "No parameters.":
    "Geen parameters.",
  "No telegrams for this yet. They appear here as they arrive.":
    "Nog geen telegrammen hiervoor. Ze verschijnen hier zodra ze binnenkomen.",
  "No telegrams to show":
    "Geen telegrammen om te tonen",
  "Nothing answered at this address.":
    "Niets antwoordde op dit adres.",
  "Nothing could be compared: the application defines no memory or properties to read back.":
    "Er viel niets te vergelijken: de applicatie definieert geen geheugen of eigenschappen om terug te lezen.",
  "Nothing matches the filter.":
    "Niets komt overeen met het filter.",
  "Numeric (9.001)":
    "Numeriek (9.001)",
  "Object index":
    "Objectindex",
  "Online":
    "Online",
  "Parameter":
    "Parameter",
  "Pick two or more devices to compare their parameters and group objects. From a device, use Compare; from the Device overview, select devices and press Compare.":
    "Kies twee of meer apparaten om hun parameters en groepsobjecten te vergelijken. Vanuit een apparaat: Vergelijken; in het Apparaatoverzicht: selecteer apparaten en klik Vergelijken.",
  "Ping":
    "Ping",
  "Preview (first page)":
    "Voorbeeld (eerste pagina)",
  "Print":
    "Afdrukken",
  "Print labels":
    "Etiketten afdrukken",
  "Print labels…":
    "Etiketten afdrukken…",
  "Product data missing":
    "Productdata ontbreekt",
  "Program the device to bring it in line.":
    "Programmeer het apparaat om het gelijk te trekken.",
  "Property id":
    "Eigenschap-id",
  "Property write":
    "Eigenschap schrijven",
  "Read serial numbers":
    "Serienummers lezen",
  "Read the device and compare it with what the project would write; nothing is written":
    "Lees het apparaat en vergelijk het met wat het project zou schrijven; er wordt niets geschreven",
  "Read the devices and compare them with the project (the selected ones, or all shown); nothing is written":
    "Lees de apparaten en vergelijk ze met het project (de geselecteerde, of alle getoonde); er wordt niets geschreven",
  "Read the serial number of every device in programming mode":
    "Lees het serienummer van elk apparaat in programmeermodus",
  "Recorded":
    "Opgenomen",
  "Sheet format":
    "Velformaat",
  "Show more":
    "Meer tonen",
  "Show the telegrams on a time axis, one lane per source":
    "Toon de telegrammen op een tijdas, één baan per bron",
  "Skip first labels":
    "Eerste etiketten overslaan",
  "Something is there, but it refused the connection (busy, or another tool has it open).":
    "Er is iets, maar het weigerde de verbinding (bezig, of een ander programma heeft het open).",
  "Start (hex with 0x)":
    "Start (hex met 0x)",
  "Start index":
    "Startindex",
  "Take the address":
    "Het adres",
  "Take the individual address away in the project (the device stays on its line; the bus device is not touched)":
    "Trek het fysieke adres in het project in (het apparaat blijft op zijn lijn; het apparaat op de bus wordt niet aangeraakt)",
  "That device carries":
    "Dat apparaat heeft",
  "The browser blocked the print window; allow pop-ups for this page.":
    "De browser heeft het afdrukvenster geblokkeerd; sta pop-ups toe voor deze pagina.",
  "The device differs from the project":
    "Het apparaat wijkt af van het project",
  "The device holds what the project would write.":
    "Het apparaat bevat wat het project zou schrijven.",
  "The device stays in the project on its line, without an address, until it gets a new one. The device on the bus keeps its address until it is programmed.":
    "Het apparaat blijft in het project op zijn lijn, zonder adres, tot het een nieuw krijgt. Het apparaat op de bus houdt zijn adres tot het geprogrammeerd wordt.",
  "The programming LED flashed":
    "De programmeer-LED heeft geknipperd",
  "These devices run different applications: parameters are lined up by page and name, which is only a rough match.":
    "Deze apparaten draaien verschillende applicaties: parameters worden naast elkaar gezet op pagina en naam, wat maar een ruwe vergelijking is.",
  "This changes the device immediately.":
    "Dit wijzigt het apparaat meteen.",
  "This device has no linked group objects yet.":
    "Dit apparaat heeft nog geen gekoppelde groepsobjecten.",
  "Time since the previous telegram in this list":
    "Tijd sinds het vorige telegram in deze lijst",
  "Timeline":
    "Tijdlijn",
  "Unassign address":
    "Adres intrekken",
  "Unknown manufacturer":
    "Onbekende fabrikant",
  "Unlinked only":
    "Alleen niet gekoppeld",
  "Use this serial number":
    "Dit serienummer gebruiken",
  "Verified":
    "Geverifieerd",
  "Verified against the project":
    "Geverifieerd tegen het project",
  "Verify against project":
    "Verifiëren tegen project",
  "Waiting for telegrams…":
    "Wachten op telegrammen…",
  "answers, but refused the connection":
    "antwoordt, maar weigerde de verbinding",
  "at":
    "op",
  "away from":
    "intrekken van",
  "byte(s) and":
    "byte(s) en",
  "device":
    "apparaat",
  "devices answered":
    "apparaten antwoordden",
  "devices match the project":
    "apparaten komen overeen met het project",
  "differs":
    "wijkt af",
  "group addresses":
    "groepsadressen",
  "group object(s) differ":
    "groepsobject(en) verschillen",
  "into":
    "in",
  "mask":
    "masker",
  "matches":
    "komt overeen",
  "matches the project":
    "komt overeen met het project",
  "newest first, since the page was opened":
    "nieuwste eerst, sinds de pagina geopend is",
  "no answer":
    "geen antwoord",
  "no serial number":
    "geen serienummer",
  "not shown":
    "niet getoond",
  "nothing to chart in this range":
    "niets om te tonen in deze periode",
  "of":
    "van",
  "other":
    "overig",
  "other devices":
    "andere apparaten",
  "parameter(s) differ":
    "parameter(s) verschillen",
  "per sheet":
    "per vel",
  "product name, the device has no name of its own":
    "productnaam, het apparaat heeft geen eigen naam",
  "propert(y/ies)":
    "eigenschap(pen)",
  "propert(y/ies) differ":
    "eigenschap(pen) verschillen",
  "reachable":
    "bereikbaar",
  "read from the payloads, this address has no datapoint type":
    "afgeleid uit de inhoud, dit adres heeft geen datapunttype",
  "selected":
    "geselecteerd",
  "sending address":
    "zendadres",
  "sheet(s)":
    "vel(len)",
  "to property":
    "naar eigenschap",
  "written":
    "geschreven",
  "written and read back":
    "geschreven en teruggelezen",
  "{n} of {m}":
    "{n} van {m}",
  "{n} device(s) are left out: their product data is not in the catalog.":
    "{n} apparaat/apparaten weggelaten: hun productdata staat niet in de catalogus.",
  "Add picture":
    "Afbeelding toevoegen",
  "DPT: 9, 9.001, temperature…":
    "DPT: 9, 9.001, temperatuur…",
  "Datapoint types…":
    "Datapunttypen…",
  "Device name":
    "Apparaatnaam",
  "IP address":
    "IP-adres",
  "MAC address":
    "MAC-adres",
  "Open the picture":
    "Afbeelding openen",
  "Open web interface":
    "Webinterface openen",
  "Read mask, application, serial number, error state and, for IP devices, the IP address from the device":
    "Masker, applicatie, serienummer, foutstatus en, bij IP-apparaten, het IP-adres uit het apparaat lezen",
  "Runs a script of the product in ETS; this editor cannot run it.":
    "Voert in ETS een script van het product uit; deze editor kan dat niet.",
  "Search: 9.001, temperature, °C, m³…":
    "Zoeken: 9.001, temperatuur, °C, m³…",
  "Unit":
    "Eenheid",
  "Upload a product picture; it is kept in Documents, tagged with the order number, and shown for every device with this order number":
    "Upload een productafbeelding; die wordt bij Documenten bewaard met het bestelnummer als label en getoond bij elk apparaat met dit bestelnummer",
  "datapoint types":
    "datapunttypen",
  "every":
    "alle",
  "unknown type":
    "onbekend type",
  "No rooms in the project yet; add them in the Buildings tab":
    "Nog geen ruimtes in het project; voeg ze toe in het tabblad Gebouwen",
};

export const VIEWS_DE: Record<string, string> = {
  "Back up catalog and settings…": "Katalog und Einstellungen sichern…",
  "Restore from backup…": "Aus Sicherung wiederherstellen…",
  "Back up catalog and settings": "Katalog und Einstellungen sichern",
  "Restore from backup": "Aus Sicherung wiederherstellen",
  "Everything under /config that is not a project, in one archive: the imported product data, the document library, the gateway settings, the keys, and the decrypted project logs. Projects are backed up with Save a copy.":
    "Alles unter /config, was kein Projekt ist, in einem Archiv: die importierten Produktdaten, die Dokumentenbibliothek, die Gateway-Einstellungen, die Schlüssel und die entschlüsselten Projektprotokolle. Projekte sichern Sie mit Kopie speichern.",
  "With Settings and Keys included, the archive holds the signing key, the project log key and the keyring password in plain form. Treat it like a password file.":
    "Mit Einstellungen und Schlüsseln enthält das Archiv den Signaturschlüssel, den Projektprotokollschlüssel und das Schlüsselbund-Passwort im Klartext. Behandeln Sie es wie eine Passwortdatei.",
  "Product data (catalog)": "Produktdaten (Katalog)",
  "Gateway settings": "Gateway-Einstellungen",
  Keys: "Schlüssel",
  "Project logs": "Projektprotokolle",
  Written: "Geschrieben",
  "Back up": "Sichern",
  "Backup written": "Sicherung geschrieben",
  "Restoring adds what is in the archive; it never deletes anything already here. Product data is re-imported, so restoring an older backup over a newer catalog only fills gaps.":
    "Wiederherstellen fügt hinzu, was im Archiv ist; es löscht nie etwas Vorhandenes. Produktdaten werden neu importiert, eine ältere Sicherung über einen neueren Katalog füllt also nur Lücken.",
  "Backup file on /share": "Sicherungsdatei auf /share",
  "Pick a backup": "Sicherung wählen",
  Choose: "Wählen",
  Restore: "Wiederherstellen",
  Restored: "Wiederhergestellt",
  "Show all": "Alle anzeigen",
  "Drag onto Devices, Topology or a room to add it to the project":
    "Auf Geräte, Topologie oder einen Raum ziehen, um es dem Projekt hinzuzufügen",
  "products local": "Produkte lokal",
  "No room": "Kein Raum",
  "Drag onto a room in the Buildings dock to assign it":
    "Auf einen Raum im Gebäude-Panel ziehen, um es zuzuweisen",
  "No key stored.": "Kein Schlüssel gespeichert.",
  "Without it the log can only be read from a file decrypted elsewhere and imported in the Project dock.":
    "Ohne ihn ist das Protokoll nur aus einer anderswo entschlüsselten Datei lesbar, die im Projekt-Panel importiert wurde.",
  "Search manufacturer, product, order number or application":
    "Hersteller, Produkt, Bestellnummer oder Applikation suchen",
  "From /share": "Aus /share",
  "Import product data": "Produktdaten importieren",
  Version: "Version",
  "Available from the KNX online catalog; not imported yet":
    "Im KNX-Onlinekatalog verfügbar; noch nicht importiert",
  "Fetch every manufacturer's product list from the KNX server once (a few minutes); afterwards the search covers every brand":
    "Die Produktliste jedes Herstellers einmal vom KNX-Server holen (einige Minuten); danach durchsucht die Suche alle Marken",
  manufacturers: "Hersteller",
  "application programs": "Applikationsprogramme",
  products: "Produkte",
  online: "online",
  "An application program is the configuration program a device runs; one product ships one, and several products can share the same one.":
    "Ein Applikationsprogramm ist das Konfigurationsprogramm eines Geräts; jedes Produkt bringt eines mit, und mehrere Produkte können dasselbe verwenden.",
  "Nothing matches. Clear the filter, pick a manufacturer, or press Download to fetch the product lists from the KNX server.":
    "Nichts gefunden. Filter löschen, einen Hersteller wählen oder auf Herunterladen drücken, um die Produktlisten vom KNX-Server zu holen.",
  "The catalog is empty. Import a .knxprod from the manufacturer, or press Download to fetch the product lists from the KNX server.":
    "Der Katalog ist leer. Importieren Sie eine .knxprod des Herstellers oder drücken Sie Herunterladen, um die Produktlisten vom KNX-Server zu holen.",
  Start: "Starten",
  Stop: "Stoppen",
  stopped: "gestoppt",
  "new since": "neu seitdem",
  "Bus load": "Buslast",
  Segment: "Segment",
  devices: "Geräte",
  "not counted": "nicht gezählt",
  "no power supply in the project": "kein Netzteil im Projekt",
  "No product data in the catalog for these devices, so their draw is not counted.":
    "Keine Produktdaten im Katalog für diese Geräte, daher wird ihr Verbrauch nicht mitgezählt.",
  "Every log comment is encrypted with AES-256 under a key compiled into the commissioning tool itself, the same on every installation. The add-on does not ship that key. Store it once under Help → Project log key and the log reads here directly, including entries written back for import.":
    "Jeder Protokollkommentar ist mit AES-256 unter einem im Inbetriebnahmeprogramm selbst einkompilierten Schlüssel verschlüsselt, auf jeder Installation demselben. Das Add-on liefert diesen Schlüssel nicht mit. Speichern Sie ihn einmal unter Hilfe → Projektprotokollschlüssel, dann ist das Protokoll hier direkt lesbar, auch für zurückgeschriebene Einträge.",
  "Without the key, decrypt the log on the PC that wrote it and import the result here instead:":
    "Ohne den Schlüssel: Entschlüsseln Sie das Protokoll auf dem schreibenden PC und importieren Sie das Ergebnis hier:",
  "Decrypt it there, then put project-log.json on the share and pick it below.":
    "Entschlüsseln Sie es dort, legen Sie project-log.json auf die Freigabe und wählen Sie es unten aus.",
  "Project log key": "Projektprotokollschlüssel",
  "Every comment in a project's log is encrypted. The key is a constant inside the commissioning tool itself, the same on every installation, so the add-on does not ship it. Extract it once from your own installation and paste the lines below. It is stored under /config only. With the key present the log reads normally, and entries the add-on writes stay readable when the project goes back.":
    "Jeder Kommentar im Projektprotokoll ist verschlüsselt. Der Schlüssel ist eine Konstante im Inbetriebnahmeprogramm selbst, auf jeder Installation dieselbe, daher liefert das Add-on ihn nicht mit. Holen Sie ihn einmal aus Ihrer eigenen Installation und fügen Sie die Zeilen unten ein. Er wird nur unter /config gespeichert. Mit dem Schlüssel ist das Protokoll lesbar, und vom Add-on geschriebene Einträge bleiben lesbar, sobald das Projekt zurückgeht.",
  "Key stored": "Schlüssel gespeichert",
  "Adjust the folder if needed, run the line, and copy the key=, iv= and marker= lines:":
    "Passen Sie ggf. den Ordner an, führen Sie die Zeile aus und kopieren Sie die Zeilen key=, iv= und marker=:",
  "Key (key= / iv= / marker= lines)": "Schlüssel (Zeilen key= / iv= / marker=)",
  "Remove key": "Schlüssel entfernen",
  "Project log key stored": "Projektprotokollschlüssel gespeichert",
  "Project log key removed": "Projektprotokollschlüssel entfernt",
  "Download the encrypted entries:":
    "Laden Sie die verschlüsselten Einträge herunter:",
  "entries imported": "Einträge importiert",
  matched: "zugeordnet",
  "Log import…": "Protokoll-Import…",
  "Read the log…": "Protokoll lesen…",
  "Put project-log.json on the share and pick it below, or paste its contents.":
    "Legen Sie project-log.json auf die Freigabe und wählen Sie es unten.",
  "File on /share": "Datei auf /share",
  Import: "Importieren",
  Imported: "Importiert",
  "Remove import": "Import entfernen",
  "Try key derivations anyway": "Schlüsselableitungen trotzdem versuchen",
  "Give the path of the JSON file produced by the script.":
    "Geben Sie den Pfad der vom Skript erzeugten JSON-Datei an.",
  "entries imported.": "Einträge importiert.",
  "Import removed.": "Import entfernt.",
  "comments are encrypted": "Kommentare sind verschlüsselt",
  "Use area.line.device, for example 1.1.5":
    "Bereich.Linie.Gerät verwenden, zum Beispiel 1.1.5",
  "Area must be 0-15": "Bereich muss 0-15 sein",
  "Line must be 0-15": "Linie muss 0-15 sein",
  "Device must be 0-255": "Gerät muss 0-255 sein",
  Documents: "Dokumente",
  "Upload documents": "Dokumente hochladen",
  "document(s) uploaded": "Dokument(e) hochgeladen",
  Tag: "Etikett",
  Size: "Größe",
  Uploaded: "Hochgeladen",
  "Open in a new tab": "In neuem Tab öffnen",
  "No documents yet.": "Noch keine Dokumente.",
  "No documents for this device yet. Upload its manual or datasheet.":
    "Noch keine Dokumente für dieses Gerät. Laden Sie das Handbuch oder Datenblatt hoch.",
  "Tag (e.g. order number or device)":
    "Etikett (z. B. Bestellnummer oder Gerät)",
  "Upload manuals, datasheets and drawings (PDF, images, spreadsheets, .vd files) and open them later from the add-on. Files are stored under /config/docs. Tag a document with an order number so it shows up on that device.":
    "Laden Sie Handbücher, Datenblätter und Zeichnungen (PDF, Bilder, Tabellen, .vd-Dateien) hoch und öffnen Sie sie später aus dem Add-on. Dateien liegen unter /config/docs. Versehen Sie ein Dokument mit einer Bestellnummer, damit es beim Gerät erscheint.",
  Delete: "Löschen",
  "no project open, names and values need one":
    "kein Projekt geöffnet; Namen und Werte brauchen eines",
  decoding: "dekodiert",
  "from objects": "über Objekte",
  "Group addresses whose datapoint type is known; set the DPT of an address in the Group addresses tab to decode it":
    "Gruppenadressen mit bekanntem Datenpunkttyp; setzen Sie den DPT einer Adresse im Reiter Gruppenadressen, um sie zu dekodieren",
  "This group address has no datapoint type in the project":
    "Diese Gruppenadresse hat im Projekt keinen Datenpunkttyp",
  "no DPT": "kein DPT",
  "Stored; leave empty to keep it":
    "Gespeichert; leer lassen, um es zu behalten",
  "A password is stored. Type a new one to replace it; the stored one is never sent to the browser.":
    "Ein Passwort ist gespeichert. Geben Sie ein neues ein, um es zu ersetzen; das gespeicherte wird nie an den Browser gesendet.",
  "Try to decrypt…": "Entschlüsseln versuchen…",
  "last download": "letzter Download",
  "Add to project": "Zum Projekt hinzufügen",
  "Automatic (first in keyring)": "Automatisch (erster im Schlüsselbund)",
  "Browse /share": "/share durchsuchen",
  Building: "Gebäude",
  "Building parts": "Gebäudeteile",
  "Connect to a KNX gateway first (top right).":
    "Zuerst mit einem KNX-Gateway verbinden (oben rechts).",
  "Datapoint types differ": "Datenpunkttypen unterscheiden sich",
  Date: "Datum",
  "Device labels for the distribution board: address, name, order number, manufacturer, description and room as CSV (all devices when none are selected).":
    "Gerätebeschriftungen für die Verteilung: Adresse, Name, Bestellnummer, Hersteller, Beschreibung und Raum als CSV (alle Geräte, wenn keines ausgewählt ist).",
  "Duplicate a device several times, parameters included. Optionally rewrite the copies' names (find / replace) and create a group address for every communication object of each copy. Copies land on the same line with the next free addresses.":
    "Ein Gerät mehrfach duplizieren, Parameter inklusive. Optional die Namen der Kopien umschreiben (Suchen / Ersetzen) und für jedes Kommunikationsobjekt jeder Kopie eine Gruppenadresse anlegen. Kopien landen auf derselben Linie mit den nächsten freien Adressen.",
  "project/14 (older)": "project/14 (older)",
  "project/20 (recommended)": "project/20 (empfohlen)",
  "project/22": "project/22",
  "project/23": "project/23",
  Free: "Frei",
  Functions: "Funktionen",
  identical: "identisch",
  "Import from /share": "Aus /share importieren",
  Key: "Schlüssel",
  "New building": "Neues Gebäude",
  "No devices on this area yet.": "Noch keine Geräte in diesem Bereich.",
  "No devices on this line yet.": "Noch keine Geräte auf dieser Linie.",
  "No keyring configured. Open the gateway menu (top right) → Settings, upload your .knxkeys export and enter its password. The keyring is what makes IP Secure tunnelling and Data Secure programming possible.":
    "Kein Schlüsselbund konfiguriert. Öffnen Sie das Gateway-Menü (oben rechts) → Einstellungen, laden Sie Ihren Export (.knxkeys) hoch und geben Sie das Passwort ein. Der Schlüsselbund ermöglicht IP-Secure-Tunnel und Data-Secure-Programmierung.",
  "No product in the catalog matches this filter. Clear it to see everything, or download the product from the online catalog below.":
    "Kein Produkt im Katalog passt zu diesem Filter. Leeren Sie ihn, um alles zu sehen, oder laden Sie das Produkt unten aus dem Onlinekatalog.",
  Off: "Aus",
  On: "Ein",
  "Open, create or import a project (File menu).":
    "Ein Projekt öffnen, anlegen oder importieren (Menü Datei).",
  Raw: "Roh",
  Read: "Lesen",
  "Read mask, application, serial number and error state from the device":
    "Maske, Applikation, Seriennummer und Fehlerzustand aus dem Gerät lesen",
  "Read the device and show every byte a download would change, without writing":
    "Das Gerät lesen und jedes Byte zeigen, das ein Download ändern würde, ohne zu schreiben",
  "Rebuild a project from what is on the bus: scan a range of individual addresses, match each device's application against the catalog, read its group-address, association and parameter tables back (read-only), optionally verify the result against the device, and write the devices into the open project or a new one. Devices whose product data is missing need their .knxprod in the catalog first (Catalog tab), then use Re-identify.":
    "Ein Projekt aus dem Bus wiederherstellen: einen Bereich physikalischer Adressen scannen, die Applikation jedes Geräts dem Katalog zuordnen, Gruppenadress-, Assoziations- und Parametertabellen zurücklesen (nur lesend), das Ergebnis optional gegen das Gerät verifizieren und die Geräte in das geöffnete oder ein neues Projekt schreiben. Geräte ohne Produktdaten brauchen zuerst ihre .knxprod im Katalog (Reiter Katalog), danach Neu identifizieren.",
  "Remove group address": "Gruppenadresse entfernen",
  "Restart the device": "Das Gerät neu starten",
  Save: "Speichern",
  "This application has no memory segments to program (property based or none).":
    "Diese Applikation hat keine Speichersegmente zum Programmieren (eigenschaftsbasiert oder keine).",
  "Three level (1/2/3)": "Dreistufig (1/2/3)",
  Time: "Zeit",
  "Two level (1/2)": "Zweistufig (1/2)",
  Upload: "Hochladen",
  "Upload .knxprod": ".knxprod hochladen",
  "Write the configuration to the device":
    "Die Konfiguration in das Gerät schreiben",
  "Write this address into a device in programming mode (press its programming button first)":
    "Diese Adresse in ein Gerät im Programmiermodus schreiben (zuerst die Programmiertaste drücken)",
  Writes: "Schreibt",
  "into a device on the bus. Either press the programming button of exactly one device (its LED lights up) and leave the serial number empty, or enter the device's 6-byte serial number (printed on the device, e.g. 00 12 34 56 78 9A) to address it without programming mode.":
    "in ein Gerät am Bus. Drücken Sie die Programmiertaste genau eines Geräts (die LED leuchtet) und lassen Sie die Seriennummer leer, oder geben Sie die 6-Byte-Seriennummer des Geräts ein (auf dem Gerät aufgedruckt, z. B. 00 12 34 56 78 9A), um es ohne Programmiermodus anzusprechen.",
  "Tool version": "Toolversion",
  "Schema version": "Schemaversion",
  "Last modified": "Zuletzt geändert",
  "Project ID": "Projekt-ID",
  File: "Datei",
  "Full download": "Vollständiger Download",
  "Partial: parameters": "Teilweise: Parameter",
  "Partial: group communication": "Teilweise: Gruppenkommunikation",
  Unload: "Entladen",
  "individual address": "physikalische Adresse",
  "application program": "Applikationsprogramm",
  parameters: "Parameter",
  "communication part": "Kommunikationsteil",
  "Pick devices on the left; their communication objects appear on the right. Choose a target group address per object, let the editor pair them by name (the datapoint type must agree), or assign existing addresses sequentially from a start address. Objects without a link yet get the address as their sending address.":
    "Wählen Sie links Geräte; ihre Kommunikationsobjekte erscheinen rechts. Wählen Sie je Objekt eine Ziel-Gruppenadresse, lassen Sie den Editor nach Namen zuordnen (der Datenpunkttyp muss passen) oder weisen Sie bestehende Adressen fortlaufend ab einer Startadresse zu. Objekte ohne Verknüpfung erhalten die Adresse als sendende Adresse.",
  "Connect two objects directly (a push button to an actuator channel, say): the editor creates a group address, gives it the sending object's datapoint type and links both. Leave the address empty for the first free one; the name defaults to the sending object's name.":
    "Zwei Objekte direkt verbinden (etwa einen Taster mit einem Aktorkanal): der Editor legt eine Gruppenadresse an, gibt ihr den Datenpunkttyp des sendenden Objekts und verknüpft beide. Adresse leer lassen für die erste freie; der Name entspricht standardmäßig dem sendenden Objekt.",
  "Replace a device by a copy of another project device (for example a newer application version or a different model) while keeping its name, address, room and group-address links. Objects are matched by number and size; unmatched links are reported.":
    "Ein Gerät durch eine Kopie eines anderen Projektgeräts ersetzen (etwa eine neuere Applikationsversion oder ein anderes Modell) und dabei Name, Adresse, Raum und Gruppenadress-Verknüpfungen behalten. Objekte werden nach Nummer und Größe zugeordnet; nicht zuordenbare Verknüpfungen werden gemeldet.",
  "Move a block of devices to other addresses on their line by adding an offset to the device number (e.g. +10 turns 1.1.5 into 1.1.15). The whole result is checked for range and collisions first; with a conflict nothing is written.":
    "Einen Block von Geräten auf andere Adressen ihrer Linie verschieben, indem ein Versatz zur Gerätenummer addiert wird (z. B. +10 macht aus 1.1.5 1.1.15). Das gesamte Ergebnis wird zuerst auf Bereich und Kollisionen geprüft; bei einem Konflikt wird nichts geschrieben.",
  "MDT DALI Control gateway: read the DALI bus (ballasts, groups), identify a ballast by blinking it, and run a new or post installation. Installation actions renumber ballasts on the DALI bus; start every session with a read-only scan. Manufacturer specific; verified on few devices.":
    "MDT DALI Control Gateway: den DALI-Bus lesen (EVGs, Gruppen), ein EVG durch Blinken identifizieren und eine Neu- oder Nachinstallation ausführen. Installationsaktionen nummerieren die EVGs auf dem DALI-Bus neu; beginnen Sie jede Sitzung mit einem reinen Lese-Scan. Herstellerspezifisch; auf wenigen Geräten geprüft.",
  "The KNX Data Secure keyring the add-on uses for IP Secure tunnels and secure device programming. Keys are masked; reveal them only on a trusted screen. A converted copy under another password can be handed to another tool or installer.":
    "Der KNX-Data-Secure-Schlüsselbund, den das Add-on für IP-Secure-Tunnel und sichere Geräteprogrammierung nutzt. Schlüssel sind maskiert; zeigen Sie sie nur auf einem vertrauenswürdigen Bildschirm. Eine konvertierte Kopie unter anderem Passwort kann an ein anderes Werkzeug oder einen Installateur gegeben werden.",
  Abort: "Abbrechen",
  "Add a device from the catalog": "Gerät aus dem Katalog hinzufügen",
  "add an address": "Adresse hinzufügen",
  "Add child space": "Unterraum hinzufügen",
  Address: "Adresse",
  "Address (auto)": "Adresse (automatisch)",
  Alarm: "Alarm",
  "All off": "Alle aus",
  "All on": "Alle ein",
  Application: "Applikation",
  "Application program": "Applikationsprogramm",
  "Application program loaded": "Applikationsprogramm geladen",
  "Application version": "Applikationsversion",
  Assign: "Zuweisen",
  "Assign address": "Adresse zuweisen",
  "Assign individual address": "Physikalische Adresse zuweisen",
  "Assign sequentially": "Fortlaufend zuweisen",
  Authentication: "Authentifizierung",
  "Auto-pair all": "Alle automatisch zuordnen",
  "Auto-pair empty": "Leere automatisch zuordnen",
  "Backbone key": "Backbone-Schlüssel",
  Becomes: "Wird zu",
  Blink: "Blinken",
  Cancel: "Abbrechen",
  "Channel 1": "Kanal 1",
  "Channel 2": "Kanal 2",
  Check: "Prüfen",
  "Check every device for a missing, malformed or duplicate individual address and for missing product data. Click a finding to open the device.":
    "Prüft jedes Gerät auf eine fehlende, ungültige oder doppelte physikalische Adresse und auf fehlende Produktdaten. Klicken Sie auf einen Befund, um das Gerät zu öffnen.",
  "Choose keyring": "Schlüsselbund wählen",
  Clear: "Leeren",
  "Click a device to open it in the Editor.":
    "Klicken Sie auf ein Gerät, um es im Editor zu öffnen.",
  Close: "Schließen",
  Comment: "Kommentar",
  Communication: "Kommunikation",
  "Confirm DALI installation": "DALI-Installation bestätigen",
  "Connect a client": "Einen Client verbinden",
  "Connect automatically when the add-on starts":
    "Beim Start des Add-ons automatisch verbinden",
  "Connect to a KNX interface to commission the DALI bus.":
    "Verbinden Sie sich mit einer KNX-Schnittstelle, um den DALI-Bus in Betrieb zu nehmen.",
  Connection: "Verbindung",
  "Connection settings": "Verbindungseinstellungen",
  "Connection settings…": "Verbindungseinstellungen…",
  Continue: "Fortfahren",
  Convert: "Konvertieren",
  Copies: "Kopien",
  "Copy name": "Name der Kopie",
  "Copy to clipboard": "In die Zwischenablage kopieren",
  Copy: "Kopieren",
  Create: "Anlegen",
  "Create group addresses for every copy":
    "Gruppenadressen für jede Kopie anlegen",
  "Create project and add": "Projekt anlegen und hinzufügen",
  "Created by": "Erstellt von",
  "Created under /config/projects. Area 1 / line 1 are ready for devices.":
    "Angelegt unter /config/projects. Bereich 1 / Linie 1 sind bereit für Geräte.",
  "DALI bus": "DALI-Bus",
  "Data type": "Datentyp",
  "Decrypt project log": "Projektprotokoll entschlüsseln",
  "Delete group and its addresses": "Gruppe und ihre Adressen löschen",
  Description: "Beschreibung",
  Destination: "Ziel",
  Device: "Gerät",
  "Device added": "Gerät hinzugefügt",
  "Device programmed": "Gerät programmiert",
  "Device to replace": "Zu ersetzendes Gerät",
  Devices: "Geräte",
  "Devices without a room": "Geräte ohne Raum",
  Disconnect: "Trennen",
  Download: "Download",
  "Download every manufacturer's product list once (a few minutes); afterwards the search box covers all brands":
    "Die Produktliste jedes Herstellers einmal laden (einige Minuten); danach durchsucht das Suchfeld alle Marken",
  "Download required": "Download erforderlich",
  "e.g. DPST-1-1, 9.001, temperature": "z. B. DPST-1-1, 9.001, Temperatur",
  encrypted: "verschlüsselt",
  "Error state": "Fehlerzustand",
  "ECG number": "EVG-Nummer",
  "Every device has a valid, unique address.":
    "Jedes Gerät hat eine gültige, eindeutige Adresse.",
  "Every edit is written to the project file immediately, so this is for backups or for moving the project to another Home Assistant. Paths under /share are visible from the network share.":
    "Jede Änderung wird sofort in die Projektdatei geschrieben; dies dient für Sicherungen oder zum Umzug des Projekts auf einen anderen Home Assistant. Pfade unter /share sind über die Netzwerkfreigabe sichtbar.",
  "Experimental software. Not affiliated with the KNX Association.":
    "Experimentelle Software. Nicht mit der KNX Association verbunden.",
  Export: "Exportieren",
  "Export project": "Projekt exportieren",
  "Extended copy": "Erweitertes Kopieren",
  "Extract the key on the Windows PC (PowerShell)":
    "Den Schlüssel auf dem Windows-PC auslesen (PowerShell)",
  Filter: "Filter",
  "Filter devices": "Geräte filtern",
  "Filter devices (name, address, product)":
    "Geräte filtern (Name, Adresse, Produkt)",
  "Filter parameters…": "Parameter filtern…",
  "Find in name": "Im Namen suchen",
  Firmware: "Firmware",
  Format: "Format",
  "Gateway IP": "Gateway-IP",
  "Gateways on the network": "Gateways im Netzwerk",
  "Genuine key set": "Echter Schlüssel gesetzt",
  Group: "Gruppe",
  "Group address": "Gruppenadresse",
  "Group address style": "Gruppenadress-Stil",
  "Group addresses": "Gruppenadressen",
  "Group communication loaded": "Gruppenkommunikation geladen",
  "Group monitor": "Gruppenmonitor",
  "Group objects": "Gruppenobjekte",
  Hardware: "Hardware",
  "Hardware type": "Hardwaretyp",
  "Home Assistant's integration usually occupies the first user in the keyring; pick another one for the editor.":
    "Die Home-Assistant-Integration belegt meist den ersten Benutzer im Schlüsselbund; wählen Sie für den Editor einen anderen.",
  "Home Assistant's KNX integration usually holds one tunnel on your gateway. If the gateway has a single tunnel slot, disconnect the integration first or use routing. Stored in /config/settings.json.":
    "Die KNX-Integration von Home Assistant hält meist einen Tunnel auf dem Gateway. Hat das Gateway nur einen Tunnel, trennen Sie zuerst die Integration oder nutzen Sie Routing. Gespeichert in /config/settings.json.",
  "Import .knxprod": ".knxprod importieren",
  "Import project": "Projekt importieren",
  "Individual address": "Physikalische Adresse",
  "Individual address loaded": "Physikalische Adresse geladen",
  Interfaces: "Schnittstellen",
  "Key (MOD= / EXP= / D= lines, or hex)":
    "Schlüssel (Zeilen MOD= / EXP= / D=, oder hex)",
  "Keyring (.knxkeys) for IP Secure": "Schlüsselbund (.knxkeys) für IP Secure",
  "Keyring password (set when the keyring was exported)":
    "Schlüsselbund-Passwort (beim Exportieren vergeben)",
  "KNX online catalog": "KNX-Onlinekatalog",
  Labels: "Beschriftungen",
  Length: "Länge",
  Licence: "Lizenz",
  Link: "Verknüpfen",
  "Link a group address": "Eine Gruppenadresse verknüpfen",
  "Link as sending": "Als sendend verknüpfen",
  "Link mapping": "Zuordnung der Verknüpfungen",
  "Linked to": "Verknüpft mit",
  "Linked with": "Verknüpft mit",
  Links: "Verknüpfungen",
  "Load manufacturers": "Hersteller laden",
  Loaded: "Geladen",
  "Loading…": "Lädt…",
  "Long address": "Langadresse",
  "Make sending": "Sendend machen",
  "make sending": "sendend machen",
  "Management password": "Verwaltungspasswort",
  Manufacturer: "Hersteller",
  "Manufacturer (type to search; empty = all)":
    "Hersteller (zum Suchen tippen; leer = alle)",
  "Mask version": "Maskenversion",
  Medium: "Medium",
  "Memory preview": "Speichervorschau",
  "Multicast group (routing)": "Multicast-Gruppe (Routing)",
  "Needs attention only": "Nur Handlungsbedarf",
  "needs a manufacturer plug-in": "benötigt Hersteller-Plug-in",
  "New address in this group": "Neue Adresse in dieser Gruppe",
  "New group address (next free)": "Neue Gruppenadresse (nächste freie)",
  "New installation…": "Neuinstallation…",
  "New keyring password": "Neues Schlüsselbund-Passwort",
  "New main group": "Neue Hauptgruppe",
  "New middle group": "Neue Mittelgruppe",
  "New pair": "Neues Paar",
  "New project": "Neues Projekt",
  "New project name": "Name des neuen Projekts",
  "New space": "Neuer Raum",
  "No building functions here.": "Keine Gebäudefunktionen hier.",
  "No buildings yet.": "Noch keine Gebäude.",
  "No devices in this space. Assign devices from the Buildings tab or a device's editor.":
    "Keine Geräte in diesem Raum. Weisen Sie Geräte über den Reiter Gebäude oder den Editor eines Geräts zu.",
  "No devices yet.": "Noch keine Geräte.",
  "No edits yet. Every change can be undone here.":
    "Noch keine Änderungen. Jede Änderung kann hier rückgängig gemacht werden.",
  "No findings. The project looks consistent.":
    "Keine Befunde. Das Projekt wirkt konsistent.",
  "No group addresses yet. Create a main group, then addresses inside it.":
    "Noch keine Gruppenadressen. Legen Sie eine Hauptgruppe an, dann Adressen darin.",
  "No KNX/IP gateways answered the search":
    "Kein KNX/IP-Gateway hat auf die Suche geantwortet",
  "No objects. Select a device with product data on the left.":
    "Keine Objekte. Wählen Sie links ein Gerät mit Produktdaten.",
  "No project open.": "Kein Projekt geöffnet.",
  "No sub-spaces.": "Keine Unterräume.",
  "None found yet": "Noch nichts gefunden",
  "Not assigned to a room": "Keinem Raum zugewiesen",
  "not in catalog": "nicht im Katalog",
  "Not linked to any group object. Link it from a device's Group objects tab.":
    "Mit keinem Gruppenobjekt verknüpft. Verknüpfen Sie sie über den Reiter Gruppenobjekte eines Geräts.",
  Number: "Nummer",
  Object: "Objekt",
  "Object function": "Objektfunktion",
  "Object ↔ object": "Objekt ↔ Objekt",
  "Objects → group addresses": "Objekte → Gruppenadressen",
  Offset: "Versatz",
  "Open a project first.": "Öffnen Sie zuerst ein Projekt.",
  "Open a project to see its topology.":
    "Öffnen Sie ein Projekt, um seine Topologie zu sehen.",
  "Open project": "Projekt öffnen",
  "Order info": "Bestellinfo",
  "Order number": "Bestellnummer",
  "Overwrite if it exists": "Überschreiben, falls vorhanden",
  "Own individual address (optional)":
    "Eigene physikalische Adresse (optional)",
  Package: "Paket",
  "Pairs to create": "Anzulegende Paare",
  Parameters: "Parameter",
  "Parameters loaded": "Parameter geladen",
  Password: "Passwort",
  Pause: "Pause",
  "Pick a device": "Gerät wählen",
  "Placeholder key in use": "Platzhalterschlüssel in Gebrauch",
  "Post installation…": "Nachinstallation…",
  "Preview memory": "Speicher ansehen",
  Priority: "Priorität",
  Product: "Produkt",
  "Product ref": "Produktreferenz",
  Program: "Programmieren",
  "Program device": "Gerät programmieren",
  "Program ref": "Programmreferenz",
  "Programming mode": "Programmiermodus",
  Project: "Projekt",
  "Project imported": "Projekt importiert",
  "Project password": "Projektpasswort",
  "Project password (leave empty if the export is not protected)":
    "Projektpasswort (leer lassen, wenn der Export nicht geschützt ist)",
  Property: "Eigenschaft",
  "Re-identify": "Neu identifizieren",
  "Read back": "Auslesen",
  "Read from device": "Aus Gerät lesen",
  Receiving: "Empfangend",
  "Receiving object": "Empfangendes Objekt",
  Reload: "Neu laden",
  Remove: "Entfernen",
  "Replace device": "Gerät ersetzen",
  "Replace with": "Ersetzen durch",
  "Replace with a copy of": "Ersetzen durch eine Kopie von",
  Reset: "Zurücksetzen",
  "Reset to placeholder": "Auf Platzhalter zurücksetzen",
  "Reset…": "Zurücksetzen…",
  Restart: "Neustart",
  "Restart sent": "Neustart gesendet",
  "Reveal keys": "Schlüssel anzeigen",
  "Reverted to the placeholder key":
    "Auf den Platzhalterschlüssel zurückgesetzt",
  "Rows with a DPT mismatch are skipped.":
    "Zeilen mit abweichendem DPT werden übersprungen.",
  "Run check": "Prüfung ausführen",
  "Run “Scan bus” to read the DALI bus.":
    "„Bus scannen“ ausführen, um den DALI-Bus zu lesen.",
  Running: "Läuft",
  "Save a copy": "Kopie speichern",
  "Save copy": "Kopie speichern",
  "Save key": "Schlüssel speichern",
  Scan: "Scannen",
  "Scan again": "Erneut scannen",
  "Scan bus": "Bus scannen",
  "Scanning…": "Scannt…",
  "Search products": "Produkte suchen",
  "Select shown": "Angezeigte auswählen",
  Sending: "Sendend",
  "Sending object": "Sendendes Objekt",
  Sequence: "Sequenz",
  "Serial number": "Seriennummer",
  "Serial number (optional)": "Seriennummer (optional)",
  "Shift addresses": "Adressen verschieben",
  Shift: "Verschieben",
  "Signing key": "Signaturschlüssel",
  "Signing key stored": "Signaturschlüssel gespeichert",
  Snapshot: "Momentaufnahme",
  Source: "Quelle",
  "Source device": "Quellgerät",
  Space: "Raum",
  "Start address, e.g. 1/2/0": "Startadresse, z. B. 1/2/0",
  State: "Zustand",
  Status: "Status",
  "Sub-spaces": "Unterräume",
  "Target group address": "Ziel-Gruppenadresse",
  "Test before programming": "Vor dem Programmieren testen",
  "The catalog is empty. Upload a .knxprod from the manufacturer, drop files into /share, or download from the online catalog below.":
    "Der Katalog ist leer. Laden Sie eine .knxprod des Herstellers hoch, legen Sie Dateien in /share ab oder laden Sie unten aus dem Onlinekatalog.",
  "The device already holds this configuration.":
    "Das Gerät enthält diese Konfiguration bereits.",
  "The KNX online catalog has no downloadable product for this program reference. Try the catalog search or upload the .knxprod from the manufacturer.":
    "Der KNX-Onlinekatalog hat kein ladbares Produkt für diese Programmreferenz. Versuchen Sie die Katalogsuche oder laden Sie die .knxprod des Herstellers hoch.",
  "The project has no devices yet.": "Das Projekt hat noch keine Geräte.",
  "Third-party licences": "Lizenzen Dritter",
  "This group address no longer exists.":
    "Diese Gruppenadresse existiert nicht mehr.",
  "This space no longer exists.": "Dieser Raum existiert nicht mehr.",
  "Tool key": "Werkzeugschlüssel",
  Tools: "Werkzeuge",
  "Topology check": "Topologieprüfung",
  Transmit: "Übertragen",
  "Try project password…": "Projektpasswort probieren…",
  "Trying…": "Probiere…",
  "Tunnel user (IP Secure)": "Tunnelbenutzer (IP Secure)",
  Unassign: "Zuweisung aufheben",
  Unlink: "Verknüpfung lösen",
  "Unload the application (select scope Unload, then Program device)":
    "Die Applikation entladen (Umfang Entladen wählen, dann Gerät programmieren)",
  Update: "Aktualisieren",
  Value: "Wert",
  "value: 0-63 or hex bytes": "Wert: 0-63 oder Hex-Bytes",
  Verify: "Verifizieren",
  "Without group": "Ohne Gruppe",
  "Working with it": "Damit arbeiten",
  Write: "Schreiben",
  "Write into a project": "In ein Projekt schreiben",
  "Write to": "Schreiben nach",
  "XKNX Editor comes with no stability or safety guarantees. It writes to real KNX hardware: a failed or interrupted download can leave a device unloaded until it is reprogrammed. Do not use it on an installation you cannot afford to take offline, and keep a known-good backup of any project before opening it here.":
    "XKNX Editor bietet keine Stabilitäts- oder Sicherheitsgarantien. Es schreibt auf echte KNX-Hardware: ein fehlgeschlagener oder unterbrochener Download kann ein Gerät entladen zurücklassen, bis es neu programmiert ist. Verwenden Sie es nicht in einer Anlage, die nicht ausfallen darf, und bewahren Sie eine Sicherung jedes Projekts auf, bevor Sie es hier öffnen.",
  "Add to open project": "Zum geöffneten Projekt hinzufügen",
  "Add pair": "Paar hinzufügen",
  "Download CSV": "CSV herunterladen",
  "Remove from project": "Aus dem Projekt entfernen",
  "Fetch product data online": "Produktdaten online holen",
  "Open catalog": "Katalog öffnen",
  "No scan yet.": "Noch kein Scan.",
  "No device answered in that range.":
    "Kein Gerät hat in diesem Bereich geantwortet.",
  From: "Von",
  "product found": "Produkt gefunden",
  "confirm product": "Produkt bestätigen",
  "not programmed": "nicht programmiert",
  "product data missing": "Produktdaten fehlen",
  "read back": "ausgelesen",
  error: "Fehler",
  "already in project": "bereits im Projekt",
  "added to project": "zum Projekt hinzugefügt",
  Mask: "Maske",
  Slot: "Slot",
  Type: "Typ",
  Host: "Host",
  User: "Benutzer",
  Target: "Ziel",
  Room: "Raum",
  Name: "Name",
  Live: "Live",
  Archive: "Archiv",
  recording: "Aufzeichnung läuft",
  connected: "verbunden",
  "reconnecting…": "Verbindung wird wiederhergestellt…",
  "not connected": "nicht verbunden",
  "Filter (name, value, source…)": "Filter (Name, Wert, Quelle…)",
  "Address: 1/2/ shows a whole middle group, 1/2/3 one address":
    "Adresse: 1/2/ zeigt eine ganze Mittelgruppe, 1/2/3 eine Adresse",
  "Datapoint type: 9 for every 9.xxx, 9.001 for one sub-type":
    "Datenpunkttyp: 9 für alle 9.xxx, 9.001 für einen Untertyp",
  "Chart this address": "Diese Adresse als Diagramm",
  "Last hour": "Letzte Stunde",
  "Last 6 hours": "Letzte 6 Stunden",
  "Last 24 hours": "Letzte 24 Stunden",
  "Last 7 days": "Letzte 7 Tage",
  "Last 30 days": "Letzte 30 Tage",
  "Custom range": "Eigener Bereich",
  "Source address": "Quelladresse",
  All: "Alle",
  Individual: "Individuell",
  Refresh: "Aktualisieren",
  "Export the filtered archive as CSV":
    "Das gefilterte Archiv als CSV exportieren",
  "Recording settings": "Aufzeichnungseinstellungen",
  "Load more": "Mehr laden",
  more: "weitere",
  "Nothing recorded in this range.":
    "In diesem Bereich wurde nichts aufgezeichnet.",
  "Recording is off. Turn it on under the settings button to keep every telegram on disk.":
    "Die Aufzeichnung ist aus. Schalten Sie sie unter der Einstellungen-Schaltfläche ein, um jedes Telegramm auf der Festplatte zu behalten.",
  Recording: "Aufzeichnung",
  "Every telegram the connection sees is written to /config/telegrams.db, whether the live monitor is running or not. The Archive, the Charts and the Statistics read from it.":
    "Jedes Telegramm, das die Verbindung sieht, wird nach /config/telegrams.db geschrieben, ob der Live-Monitor läuft oder nicht. Archiv, Diagramme und Statistik lesen daraus.",
  "Record telegrams": "Telegramme aufzeichnen",
  "Keep for (days, 0 = no limit)": "Aufbewahren für (Tage, 0 = unbegrenzt)",
  "Keep at most (telegrams, 0 = no limit)":
    "Höchstens aufbewahren (Telegramme, 0 = unbegrenzt)",
  Stored: "Gespeichert",
  telegrams: "Telegramme",
  oldest: "ältestes",
  newest: "neuestes",
  "Round-the-clock recording needs the connection to come back after a restart: turn on “Connect automatically when the add-on starts” in the gateway settings.":
    "Eine Aufzeichnung rund um die Uhr braucht die Verbindung nach einem Neustart zurück: Schalten Sie „Beim Start des Add-ons automatisch verbinden“ in den Gateway-Einstellungen ein.",
  "Clear archive": "Archiv leeren",
  "Delete every recorded telegram? This cannot be undone.":
    "Alle aufgezeichneten Telegramme löschen? Das lässt sich nicht rückgängig machen.",
  "Archive cleared": "Archiv geleert",
  "Recording settings saved": "Aufzeichnungseinstellungen gespeichert",
  "Show the recorded values of this address":
    "Die aufgezeichneten Werte dieser Adresse anzeigen",
  Chart: "Diagramm",
  "Add a group address (address or name)":
    "Gruppenadresse hinzufügen (Adresse oder Name)",
  "Open a project to pick addresses by name":
    "Öffnen Sie ein Projekt, um Adressen nach Namen zu wählen",
  "Up to four addresses at a time; remove one first.":
    "Höchstens vier Adressen gleichzeitig; entfernen Sie zuerst eine.",
  Line: "Linie",
  Steps: "Stufen",
  Area: "Fläche",
  "Pick a group address above, or press the chart button on a telegram in the group monitor or on a group address. Values come from the recorded archive; the range “Last hour” and the like keep growing live.":
    "Wählen Sie oben eine Gruppenadresse oder drücken Sie die Diagramm-Schaltfläche bei einem Telegramm im Gruppenmonitor oder bei einer Gruppenadresse. Die Werte stammen aus dem aufgezeichneten Archiv; Bereiche wie „Letzte Stunde“ wachsen live mit.",
  Telegrams: "Telegramme",
  Min: "Min",
  Max: "Max",
  Average: "Mittel",
  Last: "Letzter",
  "averaged per": "gemittelt je",
  "no numeric values in this range":
    "keine numerischen Werte in diesem Bereich",
  "No statistics yet.": "Noch keine Statistik.",
  "per minute": "pro Minute",
  "busiest address": "meistgenutzte Adresse",
  "busiest device": "aktivstes Gerät",
  "Telegrams over time": "Telegramme im Zeitverlauf",
  "Activity by weekday and hour": "Aktivität nach Wochentag und Stunde",
  "Recorder availability": "Verfügbarkeit der Aufzeichnung",
  "Busiest group addresses": "Meistgenutzte Gruppenadressen",
  "Busiest devices": "Aktivste Geräte",
  "link lost": "Verbindung verloren",
  "add-on not running": "Add-on lief nicht",
  "Quiet bus while recording (nothing for more than 30 minutes):":
    "Stiller Bus während der Aufzeichnung (länger als 30 Minuten nichts):",
  Mon: "Mo",
  Tue: "Di",
  Wed: "Mi",
  Thu: "Do",
  Fri: "Fr",
  Sat: "Sa",
  Sun: "So",
  "Find (address or name)": "Suchen (Adresse oder Name)",
  "All rooms": "Alle Räume",
  Fit: "Einpassen",
  "device (colour = room)": "Gerät (Farbe = Raum)",
  "group address (colour = main group)": "Gruppenadresse (Farbe = Hauptgruppe)",
  "arrow = sending object": "Pfeil = sendendes Objekt",
  addresses: "Adressen",
  links: "Verknüpfungen",
  "addresses without a link are not shown":
    "Adressen ohne Verknüpfung werden nicht gezeigt",
  "Open a project to see its devices and group addresses as a network.":
    "Öffnen Sie ein Projekt, um seine Geräte und Gruppenadressen als Netzwerk zu sehen.",
  "Open in editor": "Im Editor öffnen",
  "Nothing numeric was recorded for these addresses in this range.":
    "In diesem Bereich wurde für diese Adressen nichts Numerisches aufgezeichnet.",
  "No project is open, so telegrams are recorded without a datapoint type and cannot be charted. Open the project: the addresses it knows are decoded, including what was recorded before.":
    "Es ist kein Projekt geöffnet, daher werden Telegramme ohne Datenpunkttyp aufgezeichnet und lassen sich nicht darstellen. Öffnen Sie das Projekt: Die Adressen, die es kennt, werden entschlüsselt, auch das zuvor Aufgezeichnete.",
  "These addresses have no datapoint type in the project. Set it in the Group addresses tab and the recorded telegrams are decoded.":
    "Diese Adressen haben im Projekt keinen Datenpunkttyp. Setzen Sie ihn unter Gruppenadressen, dann werden die aufgezeichneten Telegramme entschlüsselt.",
  "Find manual": "Handbuch suchen",
  "No manual found; opened a web search for this device instead":
    "Kein Handbuch gefunden; stattdessen wurde eine Websuche für dieses Gerät geöffnet",
  "Remove device from project": "Gerät aus dem Projekt entfernen",
  "from the project? Its parameters and links are removed with it; the bus device is not touched.":
    "aus dem Projekt entfernen? Parameter und Verknüpfungen gehen mit; das Gerät am Bus bleibt unberührt.",
  "Read from the payload length, not from the project. Set the datapoint type of this address to see the real value.":
    "Aus der Länge der Nutzdaten abgeleitet, nicht aus dem Projekt. Setzen Sie den Datenpunkttyp dieser Adresse für den echten Wert.",
  "Looking for a device in programming mode…":
    "Suche nach einem Gerät im Programmiermodus…",
  "One device is in programming mode": "Ein Gerät ist im Programmiermodus",
  "Assign writes the address into it.": "Zuweisen schreibt die Adresse hinein.",
  "devices are in programming mode": "Geräte sind im Programmiermodus",
  "Leave exactly one, or give a serial number.":
    "Lassen Sie genau eines übrig oder geben Sie eine Seriennummer an.",
  "Waiting: press the programming button on the device (its LED lights up). Nothing is written until one device answers.":
    "Warten: Drücken Sie die Programmiertaste am Gerät (die LED leuchtet). Es wird nichts geschrieben, bis ein Gerät antwortet.",
  "One device is in programming mode. It currently carries":
    "Ein Gerät ist im Programmiermodus. Es trägt derzeit",
  "Assign writes": "Zuweisen schreibt",
  "into it, replacing that address.": "hinein und ersetzt diese Adresse.",
  "A full download also writes the individual address: if nothing answers at this address and exactly one device is in programming mode, that device is given the address first and then loaded.":
    "Ein vollständiger Download schreibt auch die physikalische Adresse: Antwortet unter dieser Adresse nichts und ist genau ein Gerät im Programmiermodus, erhält dieses Gerät zuerst die Adresse und wird dann geladen.",
  "Search an address or a name, or type a new address like 1/2/3":
    "Nach Adresse oder Name suchen, oder eine neue Adresse wie 1/2/3 eingeben",
  "and link it": "und verknüpfen",
  "Nothing matches. Type a full address like 1/2/3 to create it.":
    "Kein Treffer. Geben Sie eine vollständige Adresse wie 1/2/3 ein, um sie anzulegen.",
  "No group addresses yet. Type one like 1/2/3 to create it.":
    "Noch keine Gruppenadressen. Geben Sie eine wie 1/2/3 ein, um sie anzulegen.",
  Overview: "Übersicht",
  "Add a group address: pick a recorded one or type an address or name":
    "Gruppenadresse hinzufügen: eine aufgezeichnete wählen oder Adresse bzw. Name eingeben",
  "nothing numeric": "nichts Numerisches",
  "Not everything could be imported:": "Nicht alles konnte importiert werden:",
  "A coloured line sends; telegrams light up the address they are sent to.":
    "Eine farbige Linie sendet; Telegramme lassen die Adresse aufleuchten, an die sie gehen.",
  "A table of all devices grouped by room, with address, name and order number.":
    "Eine Tabelle aller Geräte nach Raum gruppiert, mit Adresse, Name und Bestellnummer.",
  "Add a device…":
    "Gerät hinzufügen…",
  "Add all with the same application":
    "Alle mit derselben Applikation hinzufügen",
  "Address unassigned":
    "Adresse entfernt",
  "All objects":
    "Alle Objekte",
  "Answered in":
    "Antwort in",
  "Answers on the bus (Ping)":
    "Antwortet auf dem Bus (Ping)",
  "Ask the bus which address the device with this serial number carries":
    "Den Bus fragen, welche Adresse das Gerät mit dieser Seriennummer hat",
  "Bytes":
    "Bytes",
  "Check that something answers at this address, and how fast":
    "Prüfen, ob unter dieser Adresse etwas antwortet, und wie schnell",
  "Check which devices answer on the bus (the selected ones, or all shown)":
    "Prüfen, welche Geräte auf dem Bus antworten (die ausgewählten oder alle angezeigten)",
  "Collapse all":
    "Alle zuklappen",
  "Common Device Object (index 0) properties: 11 serial number, 12 manufacturer, 13 program version, 15 order info, 54 programming mode, 56 max APDU length, 78 hardware type.":
    "Häufige Eigenschaften des Device Object (Index 0): 11 Seriennummer, 12 Hersteller, 13 Programmversion, 15 Bestellinfo, 54 Programmiermodus, 56 max. APDU-Länge, 78 Hardwaretyp.",
  "Compare":
    "Vergleichen",
  "Compare the selected devices side by side":
    "Die ausgewählten Geräte nebeneinander vergleichen",
  "Compare this device with other devices, parameter by parameter":
    "Dieses Gerät Parameter für Parameter mit anderen Geräten vergleichen",
  "Compare…":
    "Vergleichen…",
  "Connect to a gateway (top right) to see bus traffic.":
    "Mit einem Gateway verbinden (oben rechts), um den Busverkehr zu sehen.",
  "Connections":
    "Verbindungen",
  "Count":
    "Anzahl",
  "Data to write (hex bytes)":
    "Zu schreibende Daten (Hex-Bytes)",
  "Datapoint types":
    "Datenpunkttypen",
  "Description and notes":
    "Beschreibung und Notizen",
  "Device labels":
    "Geräteetiketten",
  "Diagnostics":
    "Diagnose",
  "Differences only":
    "Nur Unterschiede",
  "Direct access to the device's memory and interface-object properties, for troubleshooting. Reads are harmless; writes change the device immediately and are not part of the project.":
    "Direkter Zugriff auf Speicher und Interface-Objekt-Eigenschaften des Geräts, zur Fehlersuche. Lesen ist harmlos; Schreiben ändert das Gerät sofort und gehört nicht zum Projekt.",
  "Expand all":
    "Alle aufklappen",
  "Export table as CSV":
    "Tabelle als CSV exportieren",
  "Fields on a label":
    "Felder auf einem Etikett",
  "Find address by serial":
    "Adresse per Seriennummer suchen",
  "Flags C R W T U I, then the group addresses; * marks the sending one.":
    "Flags C R W T U I, dann die Gruppenadressen; * markiert die sendende.",
  "Flash the programming LED for a few seconds, to find the device in the cabinet":
    "Die Programmier-LED einige Sekunden blinken lassen, um das Gerät im Schrank zu finden",
  "For a partly used sheet":
    "Für einen teilweise benutzten Bogen",
  "Formal (DPST-9-1)":
    "Formal (DPST-9-1)",
  "Formatted in ETS; saving an edit keeps the text and drops the formatting.":
    "In ETS formatiert; beim Speichern einer Änderung bleibt der Text, die Formatierung entfällt.",
  "Friendly (name)":
    "Lesbar (Name)",
  "Function":
    "Funktion",
  "Holds what the project would write (Verify)":
    "Enthält, was das Projekt schreiben würde (Prüfen)",
  "Identify":
    "Identifizieren",
  "Installation hints":
    "Installationshinweise",
  "Legend sheet (A4 table for the distribution board door)":
    "Legendenblatt (A4-Tabelle für die Verteilertür)",
  "Linked only":
    "Nur verknüpfte",
  "Manufacturers":
    "Hersteller",
  "Memory":
    "Speicher",
  "Memory write":
    "Speicher schreiben",
  "No device answered with that serial number.":
    "Kein Gerät hat mit dieser Seriennummer geantwortet.",
  "No device is in programming mode.":
    "Kein Gerät ist im Programmiermodus.",
  "No device with an address (and, to verify, product data) to check.":
    "Kein Gerät mit Adresse (und zum Prüfen mit Produktdaten) zu prüfen.",
  "No devices in this project.":
    "Keine Geräte in diesem Projekt.",
  "No group object differs.":
    "Kein Gruppenobjekt unterscheidet sich.",
  "No group objects in this project.":
    "Keine Gruppenobjekte in diesem Projekt.",
  "No parameter differs.":
    "Kein Parameter unterscheidet sich.",
  "No parameters.":
    "Keine Parameter.",
  "No telegrams for this yet. They appear here as they arrive.":
    "Noch keine Telegramme dafür. Sie erscheinen hier, sobald sie eintreffen.",
  "No telegrams to show":
    "Keine Telegramme anzuzeigen",
  "Nothing answered at this address.":
    "Unter dieser Adresse hat nichts geantwortet.",
  "Nothing could be compared: the application defines no memory or properties to read back.":
    "Nichts zu vergleichen: die Applikation definiert keinen Speicher und keine Eigenschaften zum Zurücklesen.",
  "Nothing matches the filter.":
    "Nichts entspricht dem Filter.",
  "Numeric (9.001)":
    "Numerisch (9.001)",
  "Object index":
    "Objektindex",
  "Online":
    "Online",
  "Parameter":
    "Parameter",
  "Pick two or more devices to compare their parameters and group objects. From a device, use Compare; from the Device overview, select devices and press Compare.":
    "Zwei oder mehr Geräte wählen, um Parameter und Gruppenobjekte zu vergleichen. Von einem Gerät aus: Vergleichen; in der Geräteübersicht: Geräte auswählen und Vergleichen drücken.",
  "Ping":
    "Ping",
  "Preview (first page)":
    "Vorschau (erste Seite)",
  "Print":
    "Drucken",
  "Print labels":
    "Etiketten drucken",
  "Print labels…":
    "Etiketten drucken…",
  "Product data missing":
    "Produktdaten fehlen",
  "Program the device to bring it in line.":
    "Das Gerät programmieren, um es anzugleichen.",
  "Property id":
    "Eigenschafts-ID",
  "Property write":
    "Eigenschaft schreiben",
  "Read serial numbers":
    "Seriennummern lesen",
  "Read the device and compare it with what the project would write; nothing is written":
    "Das Gerät lesen und mit dem vergleichen, was das Projekt schreiben würde; es wird nichts geschrieben",
  "Read the devices and compare them with the project (the selected ones, or all shown); nothing is written":
    "Die Geräte lesen und mit dem Projekt vergleichen (die ausgewählten oder alle angezeigten); es wird nichts geschrieben",
  "Read the serial number of every device in programming mode":
    "Die Seriennummer jedes Geräts im Programmiermodus lesen",
  "Recorded":
    "Aufgezeichnet",
  "Sheet format":
    "Bogenformat",
  "Show more":
    "Mehr anzeigen",
  "Show the telegrams on a time axis, one lane per source":
    "Telegramme auf einer Zeitachse anzeigen, eine Spur pro Quelle",
  "Skip first labels":
    "Erste Etiketten überspringen",
  "Something is there, but it refused the connection (busy, or another tool has it open).":
    "Da ist etwas, aber es hat die Verbindung abgelehnt (beschäftigt, oder ein anderes Werkzeug hat es geöffnet).",
  "Start (hex with 0x)":
    "Start (hex mit 0x)",
  "Start index":
    "Startindex",
  "Take the address":
    "Die Adresse",
  "Take the individual address away in the project (the device stays on its line; the bus device is not touched)":
    "Die physikalische Adresse im Projekt entfernen (das Gerät bleibt auf seiner Linie; das Busgerät wird nicht berührt)",
  "That device carries":
    "Dieses Gerät hat",
  "The browser blocked the print window; allow pop-ups for this page.":
    "Der Browser hat das Druckfenster blockiert; Pop-ups für diese Seite erlauben.",
  "The device differs from the project":
    "Das Gerät weicht vom Projekt ab",
  "The device holds what the project would write.":
    "Das Gerät enthält, was das Projekt schreiben würde.",
  "The device stays in the project on its line, without an address, until it gets a new one. The device on the bus keeps its address until it is programmed.":
    "Das Gerät bleibt im Projekt auf seiner Linie, ohne Adresse, bis es eine neue bekommt. Das Gerät auf dem Bus behält seine Adresse, bis es programmiert wird.",
  "The programming LED flashed":
    "Die Programmier-LED hat geblinkt",
  "These devices run different applications: parameters are lined up by page and name, which is only a rough match.":
    "Diese Geräte haben verschiedene Applikationen: Parameter werden nach Seite und Name zugeordnet, das ist nur ein grober Vergleich.",
  "This changes the device immediately.":
    "Das ändert das Gerät sofort.",
  "This device has no linked group objects yet.":
    "Dieses Gerät hat noch keine verknüpften Gruppenobjekte.",
  "Time since the previous telegram in this list":
    "Zeit seit dem vorherigen Telegramm in dieser Liste",
  "Timeline":
    "Zeitachse",
  "Unassign address":
    "Adresse entfernen",
  "Unknown manufacturer":
    "Unbekannter Hersteller",
  "Unlinked only":
    "Nur nicht verknüpfte",
  "Use this serial number":
    "Diese Seriennummer verwenden",
  "Verified":
    "Geprüft",
  "Verified against the project":
    "Gegen das Projekt geprüft",
  "Verify against project":
    "Gegen Projekt prüfen",
  "Waiting for telegrams…":
    "Warten auf Telegramme…",
  "answers, but refused the connection":
    "antwortet, hat aber die Verbindung abgelehnt",
  "at":
    "an",
  "away from":
    "entfernen von",
  "byte(s) and":
    "Byte(s) und",
  "device":
    "Gerät",
  "devices answered":
    "Geräte haben geantwortet",
  "devices match the project":
    "Geräte entsprechen dem Projekt",
  "differs":
    "weicht ab",
  "group addresses":
    "Gruppenadressen",
  "group object(s) differ":
    "Gruppenobjekt(e) unterscheiden sich",
  "into":
    "in",
  "mask":
    "Maske",
  "matches":
    "stimmt überein",
  "matches the project":
    "entspricht dem Projekt",
  "newest first, since the page was opened":
    "neueste zuerst, seit die Seite geöffnet wurde",
  "no answer":
    "keine Antwort",
  "no serial number":
    "keine Seriennummer",
  "not shown":
    "nicht angezeigt",
  "nothing to chart in this range":
    "in diesem Zeitraum nichts darzustellen",
  "of":
    "von",
  "other":
    "sonstige",
  "other devices":
    "andere Geräte",
  "parameter(s) differ":
    "Parameter unterscheiden sich",
  "per sheet":
    "pro Bogen",
  "product name, the device has no name of its own":
    "Produktname, das Gerät hat keinen eigenen Namen",
  "propert(y/ies)":
    "Eigenschaft(en)",
  "propert(y/ies) differ":
    "Eigenschaft(en) unterscheiden sich",
  "reachable":
    "erreichbar",
  "read from the payloads, this address has no datapoint type":
    "aus den Nutzdaten gelesen, diese Adresse hat keinen Datenpunkttyp",
  "selected":
    "ausgewählt",
  "sending address":
    "sendende Adresse",
  "sheet(s)":
    "Bogen",
  "to property":
    "in Eigenschaft",
  "written":
    "geschrieben",
  "written and read back":
    "geschrieben und zurückgelesen",
  "{n} of {m}":
    "{n} von {m}",
  "{n} device(s) are left out: their product data is not in the catalog.":
    "{n} Gerät(e) ausgelassen: ihre Produktdaten sind nicht im Katalog.",
  "Add picture":
    "Bild hinzufügen",
  "DPT: 9, 9.001, temperature…":
    "DPT: 9, 9.001, Temperatur…",
  "Datapoint types…":
    "Datenpunkttypen…",
  "Device name":
    "Gerätename",
  "IP address":
    "IP-Adresse",
  "MAC address":
    "MAC-Adresse",
  "Open the picture":
    "Bild öffnen",
  "Open web interface":
    "Weboberfläche öffnen",
  "Read mask, application, serial number, error state and, for IP devices, the IP address from the device":
    "Maske, Applikation, Seriennummer, Fehlerstatus und bei IP-Geräten die IP-Adresse aus dem Gerät lesen",
  "Runs a script of the product in ETS; this editor cannot run it.":
    "Führt in ETS ein Skript des Produkts aus; dieser Editor kann das nicht.",
  "Search: 9.001, temperature, °C, m³…":
    "Suchen: 9.001, Temperatur, °C, m³…",
  "Unit":
    "Einheit",
  "Upload a product picture; it is kept in Documents, tagged with the order number, and shown for every device with this order number":
    "Ein Produktbild hochladen; es wird unter Dokumente mit der Bestellnummer als Tag gespeichert und bei jedem Gerät mit dieser Bestellnummer angezeigt",
  "datapoint types":
    "Datenpunkttypen",
  "every":
    "alle",
  "unknown type":
    "unbekannter Typ",
  "No rooms in the project yet; add them in the Buildings tab":
    "Noch keine Räume im Projekt; im Reiter Gebäude anlegen",
};
