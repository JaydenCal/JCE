"""Common content: attachments, Gantt charts."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from jcedoc import money

ISSUE = "12/10/2026"
CLIENT = "Kingsun Properties and Investments Pty Ltd [TBC: contracting entity]"
TO_LINES = [
    "Mr Maverick Parker",
    "Shaw Road Developments (Kingsun Properties and Investments Pty Ltd) [TBC: contracting entity]",
    "PO Box 46, Aitkenvale QLD 4814 [TBC]",
    "By email: [TBC: Kingsun Properties email address]",
]

TERMS = [
    ("Engagement", "JCE Infrastructure Pty Ltd (JCE) will provide the consulting services described in the accompanying Fee Proposal, together with any further services agreed in writing from time to time (the Services). The Fee Proposal, these Terms and Conditions, and any attachments together form the agreement between JCE and the Client (the Agreement). In the event of inconsistency, the order of precedence stated in the Fee Proposal applies."),
    ("Standard of care", "JCE will perform the Services with the skill, care and diligence reasonably expected of a competent consultant providing services of a similar nature at the time they are provided. JCE does not warrant a particular outcome beyond this standard."),
    ("Client's obligations and reliance", "The Client will provide JCE, free of charge and in a timely manner, with all information, documents, instructions, approvals and reasonable site access necessary to perform the Services. JCE is entitled to rely on the accuracy and completeness of information provided by or on behalf of the Client and is not responsible for verifying it unless expressly agreed."),
    ("Existing services information", "Existing services information is based on records provided by others and is indicative only unless confirmed by survey, potholing or physical service location. JCE is not responsible for inaccuracies in existing services information provided by others."),
    ("Fees and payment", "The Client will pay JCE the fees and reimbursable expenses set out in the Fee Proposal, plus GST, on the payment terms stated. Invoices may be issued progressively for Services performed, whether or not all Services are complete. Payment is due in accordance with the Fee Proposal and, where no period is stated, within fourteen (14) days of the date of invoice, without set-off or deduction. Overdue amounts may accrue interest at 2% above the Reserve Bank of Australia cash rate, calculated daily from the due date until paid."),
    ("Variations", "Any change to the scope, program or assumptions on which the fee is based may result in an adjustment to the fee and/or program. JCE will not commence varied work until the variation and its commercial effect are agreed in writing, except where instructed to proceed by the Client, in which case the varied work will be charged on a time and expenses basis at JCE's Schedule of Rates."),
    ("Design status and use of documents", "Documents are issued for the purpose stated in the relevant transmittal (such as For Review, For Approval, For Tender or For Construction). Documents must not be used for construction unless expressly issued by JCE as For Construction. The Client must not rely on superseded or draft issues."),
    ("No construction responsibility", "Unless expressly included, JCE is not engaged to provide construction supervision, superintendent services, contractor management, temporary works design, work health and safety management, construction quality assurance, or certification of completed works. JCE is not responsible for construction methods, temporary works, site safety, contractor performance, or departures from the approved design during construction."),
    ("Intellectual property and native files", "Intellectual property in the drawings, reports, models, calculations and other documents prepared by JCE remains the property of JCE. On payment in full of all amounts due, JCE grants the Client a non-exclusive licence to use the issued documents for the project for which they were prepared. Native CAD files, Civil 3D models, design surfaces, pipe networks and editable calculation files remain JCE's property and will not be issued unless expressly agreed in writing; where issued, they are provided for information only and must be verified by the recipient before use. Third-party model data licensed to JCE (including Council flood model data) is subject to the licensor's conditions and cannot be issued to the Client or any third party."),
    ("Third-party reliance", "No third party may rely on JCE's documents, advice, calculations or drawings without JCE's prior written consent. The documents may not be used for any project other than that for which they were prepared."),
    ("Limitation of liability", "To the maximum extent permitted by law, JCE's total aggregate liability to the Client arising out of or in connection with the Agreement or the Services, whether in contract, tort (including negligence), equity, under statute or otherwise, is limited to the amount stated in the Fee Proposal (Liability Cap). JCE is not liable for any indirect, consequential, economic or special loss, including loss of profit, revenue, use or opportunity. JCE is discharged from all liability in respect of the Services on the expiry of the period stated in the Fee Proposal or, if none is stated, six (6) years after completion of the Services."),
    ("Australian Consumer Law", "Nothing in the Agreement excludes, restricts or modifies any guarantee, right or remedy that cannot lawfully be excluded. To the extent permitted, JCE's liability for breach of a non-excludable guarantee is limited, at JCE's option, to supplying the relevant Services again or paying the cost of having them supplied again."),
    ("Confidentiality", "Each party will keep confidential the other's confidential information and use it only for the purposes of the Agreement, except where disclosure is required by law, the information is already public, or the other party consents in writing."),
    ("Insurance", "JCE maintains professional indemnity insurance of $10 million for any one claim and $20 million in the aggregate, and public liability insurance of $10 million. Certificates of currency are available to the Client on request."),
    ("Subconsultants and certifying engineer", "JCE may engage subconsultants and registered engineers to assist with, review or certify specialist aspects of the Services. Queensland professional engineering services are carried out by, or under the direct supervision of, a Registered Professional Engineer of Queensland (RPEQ), and RPEQ certification is provided by an appropriately registered engineer."),
    ("Suspension and termination", "Either party may terminate the Agreement on fourteen (14) days' written notice if the other is in material breach and has not remedied it within that period, or immediately on the insolvency of the other party. JCE may suspend the Services immediately if the Client fails to pay any amount when due. On termination, the Client will pay JCE for all Services performed and commitments reasonably made up to the date of termination."),
    ("Dispute resolution", "The parties will attempt in good faith to resolve any dispute (other than recovery of unpaid amounts) by negotiation and, failing resolution within fourteen (14) days, by mediation before commencing litigation. This clause does not prevent JCE from recovering money owing or seeking urgent interlocutory relief."),
    ("Assignment", "Neither party may assign or transfer its rights or obligations under the Agreement without the other's prior written consent, which will not be unreasonably withheld."),
    ("Governing law", "The Agreement is governed by the laws of New South Wales, and the parties submit to the non-exclusive jurisdiction of the courts of that jurisdiction. [TBC: Jayden to confirm NSW or Queensland law for this Queensland project.]"),
]

RATES = [
    ("Director / Principal Engineer", "$200/hr  |  $1,600/day"),
    ("RPEQ review and certification (Sunny Lotay, Lotay Civil, associate certifying engineer)", "$200/hr [TBC]"),
    ("Senior Engineer", "$190/hr  |  $1,520/day"),
    ("Project Engineer", "$180/hr  |  $1,440/day"),
    ("Design Engineer", "$170/hr  |  $1,360/day"),
    ("CAD / Drafting Technician", "$160/hr  |  $1,280/day"),
    ("Administration / Document Control", "$140/hr  |  $1,120/day"),
    ("Subconsultants: flood modelling, traffic, survey, geotechnical and other specialists", "At cost + 10%"),
]


def attachments(doc, ref_label, venant=True):
    doc.page_break()
    doc.p("ATTACHMENT A", bold=True, size=11, color=doc_gold(), after=0, keep=True)
    doc.p("Terms and Conditions", bold=True, size=14, after=6, keep=True)
    for i, (head, body) in enumerate(TERMS, 1):
        para = doc.p(f"**{i}  {head}.** {body}", size=9, after=3)
    doc.p("ATTACHMENT B", bold=True, size=11, color=doc_gold(), after=0, keep=True, before=12)
    doc.p("Schedule of Rates", bold=True, size=14, after=4, keep=True)
    doc.table(["ROLE", "RATE (EXCL. GST)"], RATES, [11.0, 6.0])
    doc.p("Rates are exclusive of GST and subject to annual review. A day is eight (8) hours. Disbursements (printing, plotting, travel and authority or lodgement fees) are charged at cost.", size=9)

    doc.page_break()
    doc.p("ATTACHMENT C", bold=True, size=11, color=doc_gold(), after=0, keep=True)
    doc.p("Key personnel", bold=True, size=14, after=4, keep=True)
    doc.p("Detailed CVs and referee contacts are available on request.", size=9.5)
    doc.sub("Jayden Callen, BEng (Hons) Civil, MIEAust (EA 11036201)")
    doc.p("Director, JCE Infrastructure Pty Ltd. Project lead and single point of contact for every stage. National Engineering Register application in progress. Jayden is not RPEQ registered; JCE's Queensland engineering is carried out under the direct supervision of Sunny Lotay, RPEQ (below).", size=9.5)
    doc.bullets([
        "**Townsville land development.** Civil Design Manager and Senior Engineer, Langtree Consulting Engineers, Townsville, 03/2025 to 05/2026: managed four civil designers on concurrent 50 to 100 lot subdivisions, including DATSIP subdivisions in Aurukun, Pormpuraaw and Napranum; coordinated flood modelling, electrical and hydraulic subconsultants into joint design packages, including culverts and retaining walls; prepared engineering services reports, engineer's estimates and bills of quantities.",
        "**Design management with tier-one contractors.** SCP Consulting, 06/2023 to 03/2025 (Civil Engineer; Site Engineer on a 12-month secondment to CPB Contractors; Senior Engineer and Design Manager, Townsville): Defence projects at RAAF Base Townsville, HMAS Cairns, RAAF Base Tindal and HMAS Watson, including site engineering and quality assurance for about 10 km of potable and fire water mains at RAAF Base Townsville.",
        "**Sewer rising mains and pump stations.** Western Sydney International Airport Business Precinct Stage One (JCE, subconsultant to Underscore Projects, client AT&L): managed the design program for the SRM-01 sewer rising main and completed the technical review of the contractor's sewage pumping station package (59 review items at Revision F, including four hold points).",
        "**Stormwater and flooding.** DRAINS and MUSIC X; flood impact assessment to ARR 2019 with specialist flood modellers; Katherine Aquatics, NT (about 80 per cent of the civil design, including earthworks pads above the 1% AEP flood level, grading, pavements, stormwater and water quality); flood levee inspection and certification report at Gunnedah, NSW (JCE, 2026).",
        "**Software.** Civil 3D (including AutoLISP automation), DRAINS, MUSIC X, CIRCLY, Allievi, Navisworks and InfraWorks.",
    ])
    doc.sub("Sunny Lotay, RPEQ [TBC: registration number and disciplines], NER")
    doc.p("Principal, Lotay Civil. JCE's associate certifying engineer under a standing associate agreement. Sunny directs and reviews JCE's civil engineering for this commission from the design basis through to issue, and certifies the work within his registered disciplines. [TBC: Jayden to confirm registration details, availability for this program and a two-line experience summary supplied by Sunny.]", size=9.5)
    if venant:
        doc.sub("Venant Solutions: specialist flood modelling [TBC: team to be confirmed in Venant's quotation]")
        doc.p("Michael South, BEng (Env)(Hons), MEnvLaw, CPEng, RPEQ, Director and Principal Engineer, is proposed as flood modelling lead and RPEQ certifier of the Flood Impact Assessment, with Atoosa Towzihian, MEng (Civil), CPEng, RPEQ, Senior Flood and Hydrology Engineer, as flood modelling project manager. Venant's Queensland work includes the Herbert River Flood Mapping Update, Bruce Highway (Ingham to Cardwell Range, Frances and Cattle Creeks) and Rockhampton Ring Road flood assessments, and flood advice on Caloundra South (Bellvista) and the Pacific Fair Shopping Centre Upgrade.", size=9.5)


def doc_gold():
    from jcedoc import GOLD
    return GOLD


def gantt(path, title, rows, milestones, xmax, xlabel="Weeks from acceptance"):
    """rows: list of (label, start, dur, kind) kind 'jce' gold, 'sub' black, 'other' hatched grey."""
    fig, ax = plt.subplots(figsize=(10, 0.48 * len(rows) + 1.4), dpi=200)
    for i, (lab, s, d, kind) in enumerate(rows):
        y = len(rows) - 1 - i
        if kind == "jce":
            ax.barh(y, d, left=s, color="#C9A227", edgecolor="black", height=0.55)
        elif kind == "sub":
            ax.barh(y, d, left=s, color="#1A1A1A", height=0.55)
        else:
            ax.barh(y, d, left=s, color="white", edgecolor="#777777", hatch="///", height=0.55)
    for lab, x, rowi in milestones:
        y = len(rows) - 1 - rowi
        ax.plot(x, y, marker="D", color="black", markersize=8, zorder=5)
        ax.text(x + 0.25, y + 0.32, lab, fontsize=8, fontweight="bold")
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels([r[0] for r in rows][::-1], fontsize=8.5)
    ax.set_xlim(0, xmax)
    ax.set_xlabel(xlabel, fontsize=9)
    ax.grid(axis="x", color="#DDDDDD")
    ax.set_axisbelow(True)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.set_title(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
