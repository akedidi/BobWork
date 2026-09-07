#!/usr/bin/env python3
"""Build the Bob Work built-in agentic profession plugins.

The generated files are committed as inspectable resources. Keeping the structured
catalog here makes the seven bundles consistent and the zip reproducible.
"""

from __future__ import annotations

import json
import shutil
import textwrap
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PLUGINS = ROOT / "plugins"
ARCHIVE = ROOT / "ibm-agentic-professions.zip"
VERSION = "1.0.1"

COMMON_SOURCES = [
    ("IBM Enterprise Design Thinking framework", "https://www.ibm.com/training/enterprise-design-thinking/framework", "Hills, Playbacks, Sponsor Users et principes de collaboration IBM."),
    ("IBM Garage", "https://www.ibm.com/garage", "Co-création, co-exécution, co-exploitation et résultats mesurables."),
]

ROLE_SPECS = [
    {
        "slug": "ibm-agentic-designer",
        "id": "builtin-ibm-agentic-designer",
        "name": "Designer",
        "icon": "designer",
        "role": "Designer",
        "description": "Transforme un besoin en expérience validée, accessible et prête pour le développement, selon une démarche compatible IBM Enterprise Design Thinking et Carbon.",
        "workflow": "Besoin → recherche UX → parcours → architecture de l’information → conception UX/UI → design system → accessibilité → Design Review → handoff dev",
        "default_prompts": ["Cadre ce besoin et prépare un plan de recherche UX.", "Conçois le parcours et les écrans de cette fonctionnalité.", "Réalise une Design Review accessible avant handoff."],
        "sources": COMMON_SOURCES + [
            ("IBM Design approach", "https://www.ibm.com/design/approach/design-thinking/", "Approche de conception centrée sur les résultats utilisateurs."),
            ("IBM Sponsor User program", "https://www.ibm.com/design/research/sponsor-user-program/overview/", "Participation continue d’utilisateurs représentatifs."),
            ("Carbon accessibility", "https://carbondesignsystem.com/guidelines/accessibility/overview/", "Référentiel accessibilité du design system Carbon."),
            ("WCAG 2.2", "https://www.w3.org/TR/WCAG22/", "Norme W3C à utiliser comme source normative pour les audits."),
        ],
        "skills": [
            ("ux-research", "Planifier et synthétiser une recherche UX traçable.", ["Transformer les incertitudes en questions de recherche et hypothèses falsifiables.", "Choisir méthodes, profils, recrutement, consentement et critères d’arrêt adaptés.", "Capturer observations, signaux contradictoires, limites et niveau de confiance.", "Relier chaque insight à une preuve puis à une décision produit."], "Plan de recherche, guide, matrice de preuves, insights priorisés et décisions.", ["Aucune conclusion sans preuve associée.", "Séparer observation, interprétation et recommandation.", "Signaler biais, échantillon et limites."]),
            ("user-journey", "Cartographier l’expérience de bout en bout et ses moments critiques.", ["Définir acteur, scénario, objectif et bornes du parcours.", "Décrire étapes, actions, canaux, pensées, émotions, irritants et opportunités.", "Relier frontstage, backstage et dépendances lorsque le service l’exige.", "Prioriser les moments de vérité par impact utilisateur et valeur métier."], "Journey map lisible, opportunités, hypothèses et métriques par étape.", ["Un scénario et un acteur explicites.", "As-is et to-be clairement distingués.", "Opportunités rattachées à des irritants observés."]),
            ("information-architecture", "Structurer contenus, navigation et taxonomie autour des modèles mentaux.", ["Inventorier contenus, objets, tâches et contraintes.", "Regrouper et nommer selon le vocabulaire utilisateur.", "Définir hiérarchie, navigation, recherche, métadonnées et états vides.", "Tester la trouvabilité par tree test, card sort ou scénarios représentatifs."], "Sitemap, taxonomie, modèle de navigation et résultats de validation.", ["Libellés non ambigus et cohérents.", "Aucun cul-de-sac de navigation.", "La structure supporte les tâches prioritaires et la croissance."]),
            ("product-design", "Passer du problème validé à une solution testable et mesurable.", ["Reformuler résultat utilisateur, contraintes et critères de succès.", "Diverger sur plusieurs options avant convergence.", "Prototyper au niveau de fidélité minimum utile.", "Tester, documenter les arbitrages et itérer avec les parties prenantes."], "Concept retenu, alternatives, prototype, résultats de test et décisions.", ["Le concept répond à un résultat, pas seulement à une liste de fonctions.", "Les alternatives et compromis restent visibles.", "Les critères de succès sont mesurables."]),
            ("ui-design", "Produire une interface cohérente, responsive et prête à construire.", ["Définir grille, hiérarchie visuelle, densité et comportements responsive.", "Composer les écrans avec des composants et tokens existants avant toute variante.", "Couvrir états normal, chargement, vide, erreur, succès, disabled et permissions.", "Annoter interactions, contenu, données et transitions nécessaires."], "Écrans haute fidélité, variantes, états et spécifications d’interaction.", ["Pas de texte tronqué ni de contraste insuffisant.", "Tous les états et tailles cibles sont couverts.", "Les composants restent réutilisables."]),
            ("design-system", "Gouverner composants, tokens et patterns comme un produit partagé.", ["Auditer l’existant et identifier doublons ou lacunes.", "Définir tokens sémantiques, anatomie, variantes, propriétés et comportements.", "Documenter usage, non-usage, accessibilité et exemples.", "Préparer contribution, versionnement, dépréciation et mesure d’adoption."], "Spécification de composant, tokens, documentation et plan de gouvernance.", ["API de composant stable et minimale.", "Design et code partagent les mêmes noms.", "Accessibilité et migration sont documentées."]),
            ("design-review", "Conduire une revue de conception factuelle avant construction ou release.", ["Fixer périmètre, scénario, critères et maturité attendue.", "Rejouer les parcours critiques et les cas limites.", "Contrôler cohérence, contenu, accessibilité, faisabilité et mesure.", "Classer les constats par sévérité, preuve, responsable et échéance."], "Rapport de revue avec verdict, anomalies priorisées et actions.", ["Chaque constat est reproductible.", "Bloquants distingués des améliorations.", "La décision go, go sous conditions ou no-go est explicite."]),
            ("ux-heuristics", "Évaluer rapidement une interface avec des heuristiques explicites.", ["Définir scénarios et profils d’évaluation.", "Inspecter visibilité du statut, contrôle utilisateur, cohérence, prévention et récupération d’erreur.", "Noter fréquence, impact, persistance et confiance.", "Proposer une correction spécifique sans confondre heuristique et test utilisateur."], "Tableau des constats heuristiques, sévérité, captures et recommandations.", ["Un constat par ligne avec emplacement exact.", "Sévérité justifiée.", "Les limites de l’évaluation experte sont rappelées."]),
            ("accessibility-audit", "Auditer l’accessibilité contre WCAG 2.2 et les critères IBM/Carbon applicables.", ["Définir niveau cible, plateformes, technologies et échantillon.", "Tester clavier, focus, zoom, contraste, structure, noms accessibles, erreurs et médias.", "Combiner contrôles automatiques et vérifications manuelles avec technologies d’assistance.", "Mapper chaque anomalie à un critère, une preuve et une correction testable."], "Rapport WCAG avec critère, niveau, sévérité, preuve, correctif et re-test.", ["Ne jamais conclure à la conformité sur automatisation seule.", "Inclure étapes de reproduction et résultat attendu.", "Protéger les données personnelles des participants."]),
            ("developer-handoff", "Transmettre une conception sans ambiguïté et accompagner son implémentation.", ["Figer flux, composants, tokens, contenus, données et règles responsive.", "Documenter états, erreurs, accessibilité, analytics et critères d’acceptation.", "Relier chaque écran aux composants et tickets concernés.", "Organiser walkthrough, canal de questions et contrôle de fidélité post-build."], "Dossier de handoff, annotations, assets, critères d’acceptation et journal de décisions.", ["Aucune valeur essentielle uniquement visible dans une maquette.", "Les cas limites et données réelles sont couverts.", "Le handoff inclut une boucle de validation."]),
        ],
    },
    {
        "slug": "ibm-agentic-consultant",
        "id": "builtin-ibm-agentic-consultant",
        "name": "Consultant",
        "icon": "consultant",
        "role": "Consultant",
        "description": "Structure un problème métier, analyse les options et produit une recommandation exécutable soumise à une Red Team Review.",
        "workflow": "Problème → cadrage → hypothèses → analyse → options → recommandation → storytelling → livrable → Red Team Review",
        "default_prompts": ["Cadre ce problème avec un issue tree MECE.", "Compare les options et construis le business case.", "Transforme cette analyse en recommandation exécutive."],
        "sources": COMMON_SOURCES,
        "skills": [
            ("problem-framing", "Définir le vrai problème, la décision et les limites de l’analyse.", ["Énoncer décision, sponsor, horizon, valeur attendue et contrainte dominante.", "Distinguer symptôme, cause, hypothèse et fait établi.", "Formuler une question directrice avec critères de succès.", "Consigner périmètre, hors-périmètre, dépendances et inconnues."], "Problem statement, decision brief, critères de succès et registre d’hypothèses.", ["Le problème est orienté décision.", "Les termes ambigus sont définis.", "Les hypothèses critiques sont testables."]),
            ("MECE", "Décomposer une question sans chevauchement matériel ni angle mort important.", ["Choisir une logique de découpage unique au niveau courant.", "Tester mutuelle exclusivité et couverture collective.", "Ajouter une catégorie résiduelle seulement si elle est réellement utile.", "Arrêter la décomposition quand les branches deviennent analysables."], "Décomposition MECE annotée avec logique, tests et limites.", ["Pas de mélange causes, solutions et métriques au même niveau.", "Tout élément a une place unique.", "Les omissions possibles sont explicitées."]),
            ("issue-tree", "Construire un arbre de questions ou d’hypothèses pilotant le travail.", ["Placer la question décisionnelle à la racine.", "Décomposer en branches MECE et hypothèses vérifiables.", "Associer analyse, donnée, responsable et échéance à chaque feuille.", "Prioriser par impact potentiel, incertitude et coût d’analyse."], "Issue tree priorisé et plan d’analyse feuille par feuille.", ["Chaque feuille peut être prouvée ou réfutée.", "Les branches répondent à la racine.", "Les priorités réduisent rapidement l’incertitude."]),
            ("stakeholder-analysis", "Comprendre acteurs, influence, intérêts et dynamique de décision.", ["Identifier décideurs, utilisateurs, financeurs, opposants, experts et personnes impactées.", "Évaluer influence, intérêt, position, dépendances et besoins d’information.", "Cartographier coalitions, tensions et chemins d’escalade.", "Définir stratégie d’engagement, message, canal, cadence et propriétaire."], "Carte des parties prenantes et plan d’engagement actionnable.", ["Ne pas déduire motivations sensibles sans preuve.", "Distinguer rôle formel et influence réelle.", "Chaque acteur critique a un propriétaire."]),
            ("process-mapping", "Visualiser un processus as-is pour localiser délais, risques et valeur.", ["Définir déclencheur, fin, client, unités et niveau de détail.", "Cartographier activités, décisions, files, handoffs, systèmes et contrôles.", "Quantifier volumes, temps de traitement, attente, erreurs et reprises.", "Valider le flux avec les opérateurs avant de concevoir le to-be."], "Process map as-is, métriques, points de douleur et opportunités.", ["Temps de travail et temps d’attente séparés.", "Exceptions réelles incluses.", "Le processus est validé par ceux qui l’exécutent."]),
            ("gap-analysis", "Comparer état actuel et état cible sans masquer les dépendances.", ["Définir dimensions et critères de maturité.", "Établir baseline sourcée et cible datée.", "Mesurer l’écart en capacité, processus, données, technologie et compétences.", "Prioriser les actions par valeur, risque, effort et dépendances."], "Matrice des écarts et plan de fermeture séquencé.", ["Baseline et cible utilisent la même échelle.", "Chaque écart a une cause et une action.", "Les dépendances et prérequis sont visibles."]),
            ("business-case", "Évaluer valeur, coût, risque et faisabilité d’une décision.", ["Définir scénario de référence et options comparables.", "Modéliser bénéfices, coûts complets, délais, capacité et hypothèses.", "Calculer métriques pertinentes et sensibilités sans fausse précision.", "Intégrer risques, impacts non financiers et conditions de réalisation."], "Business case, modèle d’hypothèses, scénarios et recommandation.", ["Baseline explicite.", "Bénéfices non doublonnés et propriétaires identifiés.", "Sensibilités sur hypothèses dominantes."]),
            ("executive-storytelling", "Construire une narration décisionnelle courte et fondée sur les preuves.", ["Commencer par décision, recommandation et valeur.", "Ordonner contexte, complication, insight, options, choix et action.", "Donner à chaque page un titre-message et une preuve principale.", "Adapter détail, ton et appel à l’action au décideur."], "Storyline, titres-messages, executive summary et call to action.", ["Une idée principale par page.", "La recommandation répond explicitement à la décision.", "Les preuves sont traçables."]),
            ("consulting-deck", "Produire un deck de conseil prêt pour une réunion exécutive.", ["Confirmer audience, décision, durée, format et template.", "Créer storyline puis storyboard avant la mise en page.", "Construire graphiques et tableaux à partir de données sourcées.", "Ajouter annexes, hypothèses, sources et notes orateur nécessaires."], "Deck exécutif avec synthèse, corps, plan d’action et annexes.", ["Titres conclusifs et lisibles.", "Sources et unités sur chaque analyse.", "Aucun élément décoratif ne masque le message."]),
            ("red-team-review", "Challenger une recommandation avant exposition au client ou décideur.", ["Séparer l’équipe qui défend de celle qui attaque lorsque possible.", "Tester logique, preuves, biais, scénarios adverses, faisabilité et incitations.", "Rechercher contre-exemples et conditions qui inversent la décision.", "Classer objections, réponse, correction, propriétaire et décision finale."], "Red Team log, faiblesses critiques, corrections et verdict de préparation.", ["La revue ne se limite pas au style.", "Les objections non résolues restent visibles.", "Le verdict et les risques acceptés sont explicites."]),
        ],
    },
    {
        "slug": "ibm-agentic-rfp",
        "id": "builtin-ibm-agentic-rfp",
        "name": "RFP / RFQ / RFT",
        "icon": "rfp",
        "role": "Consultant RFP/RFQ/RFT",
        "description": "Analyse les appels d’offres, sécurise la conformité et orchestre une proposition convaincante sans inventer de réponse.",
        "workflow": "Document → extraction exigences → analyse → compliance matrix → gaps → solution/workstreams → estimation → stratégie de réponse → proposition → Red Team",
        "default_prompts": ["Extrais toutes les exigences de cet appel d’offres.", "Construis la compliance matrix et identifie les gaps.", "Prépare la stratégie de réponse et le plan de proposition."],
        "sources": COMMON_SOURCES + [
            ("World Bank Procurement Framework", "https://www.worldbank.org/ext/en/what-we-do/project-procurement/framework", "Documents standards et exigences de passation de marchés."),
            ("World Bank Standard RFP for Consulting Services", "https://documents.worldbank.org/en/publication/documents-reports/documentdetail/099716208192520648", "Exemple officiel récent de structure RFP et de conditions de réponse."),
        ],
        "skills": [
            ("rfp-analysis", "Analyser l’intégralité d’un RFP, RFQ ou RFT et son mécanisme d’évaluation.", ["Identifier documents, addenda, dates, canal de clarification et hiérarchie contractuelle.", "Extraire objectifs, périmètre, livrables, critères, clauses et instructions de soumission.", "Repérer ambiguïtés, contradictions, dépendances et risques contractuels.", "Produire une vue de poursuite avec thèmes gagnants et questions ouvertes."], "Dossier d’analyse, calendrier, critères d’évaluation, risques et questions.", ["Chaque constat cite document, section et page.", "Les addenda sont intégrés.", "Aucune hypothèse présentée comme exigence."]),
            ("requirements-extraction", "Extraire des exigences atomiques, testables et traçables.", ["Parcourir le corpus complet, tableaux, annexes et formulaires compris.", "Scinder les phrases composites en obligations atomiques.", "Classer obligatoire, évalué, informatif, contractuel ou ambigu.", "Attribuer identifiant stable, source exacte, responsable et preuve attendue."], "Registre d’exigences atomiques avec traçabilité source.", ["Exhaustivité contrôlée par seconde passe.", "Les termes shall/must/doit et équivalents sont conservés.", "Les doublons restent reliés à toutes leurs sources."]),
            ("compliance-matrix", "Piloter la conformité de la réponse jusqu’à la soumission.", ["Importer les exigences atomiques sans les reformuler de manière trompeuse.", "Ajouter statut, réponse, preuve, section cible, propriétaire et échéance.", "Tracer écarts, dérogations, clarifications et approbations.", "Contrôler complétude et pièces obligatoires avant gel."], "Compliance matrix versionnée et tableau de bord de complétude.", ["Une ligne par exigence atomique.", "Chaque statut compliant possède une preuve.", "Les exigences non satisfaites ne sont jamais masquées."]),
            ("bid-no-bid", "Recommander objectivement de poursuivre, conditionner ou abandonner.", ["Définir critères pondérés avant de noter.", "Évaluer fit stratégique, relation, capacité, différenciation, économie, risque et probabilité.", "Tester scénarios et conditions indispensables de poursuite.", "Faire approuver décision, investissements et kill criteria."], "Scorecard bid/no-bid, conditions, risques et décision signée.", ["Les critères éliminatoires dominent le score moyen.", "La confiance des notes est indiquée.", "Les coûts de poursuite et d’opportunité sont inclus."]),
            ("gap-analysis", "Identifier les écarts de conformité et le chemin crédible pour les fermer.", ["Comparer chaque exigence aux capacités et preuves existantes.", "Classer écart produit, delivery, partenaire, contractuel, sécurité ou ressource.", "Définir remédiation, coût, délai, responsable et risque résiduel.", "Escalader les écarts qui nécessitent dérogation ou engagement exécutif."], "Gap register lié à la compliance matrix et plan de remédiation.", ["Aucun gap critique sans propriétaire.", "La remédiation est réalisable avant l’échéance.", "Les engagements futurs sont approuvés."]),
            ("proposal-strategy", "Définir une stratégie de réponse différenciante et évaluable.", ["Relier priorités du client, critères de notation et paysage concurrentiel.", "Choisir win themes, preuves, discriminants et réponses aux objections.", "Définir architecture de solution, workstreams, équipe et partenaires.", "Aligner storyline, compliance matrix, pricing et plan de production."], "Strategy brief, win themes, storyboard, preuves et plan de production.", ["Chaque win theme répond à une priorité client.", "Les discriminants sont démontrables.", "La stratégie respecte toutes les instructions."]),
            ("proposal-writing", "Rédiger une proposition claire, conforme et factuelle.", ["Suivre exactement ordre, limites, format et vocabulaire demandés.", "Répondre d’abord à l’exigence puis expliquer approche, preuve, valeur et mesure.", "Utiliser éléments de preuve approuvés et signaler les données manquantes.", "Maintenir cohérence entre solution, planning, équipe, risques et prix."], "Proposition complète avec renvois de conformité et preuves.", ["Aucune référence client ou métrique inventée.", "Les réponses sont évaluables et spécifiques.", "Les limites de pages et formulaires sont respectées."]),
            ("proposal-review", "Conduire des revues progressives puis une Red Team avant soumission.", ["Planifier revues stratégie, contenu, solution, commercial, conformité et production.", "Évaluer avec les critères du client, pas les préférences internes.", "Tracer commentaires, sévérité, propriétaire, échéance et résolution.", "Faire un contrôle final indépendant du package soumis."], "Review log, score simulé, corrections, checklist de soumission et verdict.", ["Tous les documents et addenda sont présents.", "Les bloquants sont clos ou acceptés formellement.", "Le fichier final est revalidé après packaging."]),
        ],
    },
    {
        "slug": "ibm-agentic-product-manager",
        "id": "builtin-ibm-agentic-product-manager",
        "name": "Product Manager",
        "icon": "product",
        "role": "Product Manager",
        "description": "Pilote la discovery, la stratégie, la priorisation et la mesure d’un produit à partir de résultats utilisateurs et métier.",
        "workflow": "Problème → discovery → recherche utilisateur → JTBD/personas → proposition de valeur → stratégie → priorisation → roadmap → PRD → user stories → KPI",
        "default_prompts": ["Cadre la discovery de cette opportunité produit.", "Priorise ces initiatives avec RICE et explicite les limites.", "Rédige le PRD, les user stories et les KPI."],
        "sources": COMMON_SOURCES + [
            ("Intercom RICE", "https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/", "Source originale du cadre Reach, Impact, Confidence, Effort."),
            ("Google re:Work — team effectiveness", "https://rework.withgoogle.com/en/guides/understanding-team-effectiveness", "Référence publique sur objectifs, clarté et usage des OKR."),
        ],
        "skills": [
            ("product-discovery", "Réduire les risques valeur, utilisabilité, faisabilité et viabilité avant delivery.", ["Définir opportunité, résultat, risques et inconnues critiques.", "Combiner données, recherche, marché, technologie et contraintes opérationnelles.", "Concevoir des tests rapides par hypothèse avec seuil de décision.", "Tenir un journal des preuves et décider poursuivre, pivoter ou arrêter."], "Discovery brief, backlog d’hypothèses, expériences, preuves et décisions.", ["Le test précède la construction coûteuse.", "Chaque hypothèse a un seuil de décision.", "Les preuves contradictoires sont conservées."]),
            ("user-research", "Comprendre besoins, comportements et contexte des utilisateurs produit.", ["Définir segments, questions, méthode et consentement.", "Recruter des profils représentatifs, y compris cas limites pertinents.", "Observer comportements et tâches plutôt que collecter seulement des opinions.", "Synthétiser patterns, différences, fréquence et niveau de confiance."], "Plan, notes structurées, insights, opportunités et clips/citations autorisés.", ["Séparer demande exprimée et besoin sous-jacent.", "Anonymiser les données personnelles.", "Ne pas généraliser au-delà de l’échantillon."]),
            ("JTBD", "Formuler les progrès recherchés dans un contexte donné.", ["Identifier situation déclenchante, motivation, résultat et alternatives actuelles.", "Distinguer dimensions fonctionnelle, émotionnelle et sociale.", "Formuler les jobs sans imposer une solution.", "Prioriser par importance, satisfaction actuelle et pertinence stratégique."], "Job statements, forces de changement, outcomes et opportunités.", ["Le job reste stable au-delà d’une fonctionnalité.", "Le contexte et le progrès sont explicites.", "Les outcomes sont observables."]),
            ("product-strategy", "Choisir où jouer et comment gagner avec des choix cohérents.", ["Établir diagnostic, segments, alternatives et contraintes.", "Définir vision, avantage, résultats cibles et principes de décision.", "Choisir paris et renoncements explicites.", "Relier capacités, séquence, métriques et signaux d’invalidation."], "Strategy brief avec choix, non-objectifs, paris et système de mesure.", ["La stratégie contient des renoncements.", "Les choix reposent sur un diagnostic.", "Chaque pari a un signal de revue."]),
            ("prioritization", "Comparer des opportunités avec critères explicites et gouvernance.", ["Définir unité de comparaison et horizon.", "Choisir critères liés aux objectifs, risques et contraintes.", "Normaliser les preuves et éviter la double comptabilisation.", "Documenter décision finale, exceptions et coût d’opportunité."], "Backlog priorisé, critères, scores, dépendances et journal de décision.", ["Les éléments comparés ont une granularité compatible.", "Le score n’efface pas le jugement.", "Les contraintes obligatoires sont traitées séparément."]),
            ("RICE", "Appliquer Reach × Impact × Confidence ÷ Effort de façon transparente.", ["Définir période et population pour Reach.", "Utiliser une échelle d’Impact cohérente et documentée.", "Fonder Confidence sur la qualité des preuves.", "Estimer Effort dans la même unité et effectuer une sensibilité."], "Table RICE avec sources, score, fourchettes et sensibilité.", ["Aucune estimation sans source ou hypothèse.", "Les scores ne mélangent pas périodes ou unités.", "Les risques et dépendances restent hors score mais visibles."]),
            ("roadmap", "Communiquer une séquence orientée résultats, adaptable aux preuves.", ["Partir des objectifs et problèmes, non d’une liste de fonctionnalités.", "Regrouper thèmes, outcomes, paris et jalons de validation.", "Ordonnancer par dépendances, capacité et apprentissage.", "Afficher niveau de confiance, horizons et règles de changement."], "Roadmap Now/Next/Later ou datée, outcomes, dépendances et confiance.", ["Pas de fausse précision sur les dates.", "Chaque item a un résultat attendu.", "La roadmap distingue engagement et exploration."]),
            ("PRD", "Spécifier le pourquoi, le quoi et la mesure sans sur-concevoir le comment.", ["Décrire contexte, problème, utilisateurs, objectif et non-objectifs.", "Documenter exigences, flux, règles, données, erreurs et cas limites.", "Inclure NFR, analytics, rollout, dépendances, risques et questions ouvertes.", "Définir critères d’acceptation et succès avant construction."], "PRD versionné avec décisions, exigences et plan de mesure.", ["Les exigences sont testables.", "Les non-objectifs préviennent l’expansion implicite.", "Les questions ouvertes ont responsables et dates."]),
            ("user-story", "Découper la valeur en stories petites, testables et indépendantes lorsque possible.", ["Formuler utilisateur, besoin et bénéfice.", "Ajouter contexte, règles, exemples et critères d’acceptation.", "Découper verticalement par scénario ou valeur.", "Identifier dépendances, NFR, instrumentation et définition de terminé."], "Stories prêtes, critères Given/When/Then si utiles et liens de traçabilité.", ["Pas de story purement technique sans résultat explicité.", "Les critères couvrent erreurs et permissions.", "La taille permet feedback rapide."]),
            ("product-kpi", "Définir un système de métriques actionnable et résistant aux effets pervers.", ["Relier North Star, inputs, outputs et guardrails au modèle de valeur.", "Définir formule, population, fenêtre, source, fréquence et propriétaire.", "Segmenter pour détecter moyennes trompeuses.", "Fixer baseline, cible, seuil d’alerte et décision associée."], "Metric tree et dictionnaire KPI avec gouvernance.", ["Chaque KPI a une définition calculable.", "Leading et lagging indicators sont équilibrés.", "Des guardrails limitent l’optimisation locale."]),
            ("OKR", "Transformer une intention stratégique en résultats mesurables.", ["Rédiger un objectif qualitatif, mémorable et borné.", "Choisir peu de résultats clés quantifiés mesurant un outcome.", "Établir baseline, cible, source, propriétaire et cadence.", "Séparer initiatives des résultats et revoir les apprentissages."], "OKR set, baselines, métriques, initiatives liées et cadence de revue.", ["Un résultat clé n’est pas une tâche.", "Les cibles sont ambitieuses mais interprétables.", "Les dépendances et comportements indésirables sont surveillés."]),
        ],
    },
    {
        "slug": "ibm-agentic-delivery-manager",
        "id": "builtin-ibm-agentic-delivery-manager",
        "name": "Scrum & Delivery Manager",
        "icon": "delivery",
        "role": "Scrum / Delivery Manager",
        "description": "Sécurise le flux de delivery, les engagements de sprint, les dépendances, les risques et les releases sans masquer l’incertitude.",
        "workflow": "Backlog → contrôle stories → dépendances → estimation → capacité → sprint planning → suivi risques/blockers → review → retrospective → release",
        "default_prompts": ["Contrôle ce backlog et prépare le sprint planning.", "Analyse capacité, dépendances, risques et blockers.", "Prépare la sprint review, la rétrospective et la release."],
        "sources": COMMON_SOURCES + [("The Scrum Guide", "https://scrumguides.org/scrum-guide.html", "Définition officielle de Scrum ; version courante publiée en novembre 2020.")],
        "skills": [
            ("backlog-management", "Maintenir un backlog ordonné, transparent et orienté valeur.", ["Relier chaque item à un objectif produit ou risque.", "Supprimer doublons, clarifier périmètre et rendre le travail visible.", "Ordonner par valeur, risque, dépendances et apprentissage.", "Planifier refinement juste à temps et suivre l’âge des items."], "Backlog ordonné, règles de santé et rapport de qualité.", ["Les priorités ont un rationnel.", "Les items obsolètes sont retirés.", "Le haut du backlog est suffisamment prêt."]),
            ("user-story-review", "Contrôler qu’une story est comprise et testable avant engagement.", ["Vérifier valeur, acteur, scénario et résultat.", "Examiner critères, exemples, erreurs, accessibilité et NFR.", "Détecter dépendances, ambiguïtés et besoins de découpage.", "Confirmer accord partagé sur ready et done."], "Review checklist, questions ouvertes et recommandations de découpage.", ["Les critères sont observables.", "Les dépendances sont nommées.", "Une story non prête n’est pas forcée dans le sprint."]),
            ("estimation", "Estimer collectivement l’incertitude et la taille relative.", ["Clarifier périmètre et hypothèses avant estimation.", "Choisir unité et référence cohérentes.", "Faire émerger divergences puis réestimer après discussion.", "Suivre précision à l’échelle du système, pas comme mesure individuelle."], "Estimations, hypothèses, fourchettes et principaux risques.", ["Pas de conversion mécanique points-heures.", "Les valeurs extrêmes sont discutées.", "L’estimation n’est pas une promesse individuelle."]),
            ("capacity-planning", "Calculer une capacité réaliste à partir de disponibilité et données historiques.", ["Collecter jours ouvrés, absences, support et contraintes de compétences.", "Utiliser throughput ou vélocité historique comparable.", "Réserver capacité pour incidents, dette et travail non planifié.", "Produire scénario central et plage prudente."], "Plan de capacité par équipe, hypothèses, buffers et scénarios.", ["Disponibilité n’égale pas capacité productive.", "Les compétences rares sont explicites.", "Les buffers reposent sur l’historique."]),
            ("sprint-planning", "Construire un objectif de sprint cohérent et un plan adaptable.", ["Vérifier objectif produit, capacité et définition de terminé.", "Proposer un objectif de sprint orienté résultat.", "Sélectionner avec les développeurs un ensemble cohérent d’items.", "Décomposer suffisamment, identifier risques et plan de suivi."], "Sprint Goal, backlog de sprint, capacité et risques initiaux.", ["Le but reste valable si une tâche change.", "Le plan respecte la capacité.", "Les dépendances externes ont un plan."]),
            ("dependency-analysis", "Identifier et réduire les dépendances qui menacent le flux.", ["Cartographier fournisseur, consommateur, objet, date et criticité.", "Distinguer dépendances techniques, équipe, décision, environnement et fournisseur.", "Choisir éliminer, découpler, avancer, synchroniser ou escalader.", "Suivre signaux précoces et propriétaire jusqu’à fermeture."], "Dependency map, chemin critique et actions de mitigation.", ["Chaque dépendance a deux propriétaires.", "La date nécessaire est explicite.", "Les dépendances critiques apparaissent dans le plan de sprint/release."]),
            ("RAID", "Gérer risques, actions, issues et décisions dans un registre vivant.", ["Formuler chaque entrée de manière spécifique avec impact.", "Évaluer probabilité, impact, proximité et tendance.", "Nommer propriétaire, réponse, échéance et déclencheur d’escalade.", "Fermer avec preuve et conserver décisions et risques acceptés."], "RAID log priorisé et résumé d’escalade.", ["Risques futurs séparés des issues actuelles.", "Aucune entrée critique sans action.", "Les décisions ont contexte et approbateur."]),
            ("sprint-review", "Inspecter l’incrément avec les parties prenantes et adapter le backlog.", ["Rappeler objectif et contexte de marché ou usage.", "Démontrer uniquement du travail terminé dans un environnement crédible.", "Comparer résultats, métriques et apprentissages à l’objectif.", "Décider adaptations, nouvelles opportunités et ordre du backlog."], "Agenda, démo, feedback, métriques et décisions de backlog.", ["Ce n’est pas une simple présentation de statut.", "Le feedback produit des décisions traçables.", "Le travail non terminé n’est pas présenté comme livré."]),
            ("retrospective", "Améliorer qualité et efficacité par une expérimentation d’équipe sûre.", ["Créer sécurité et rappeler le cadre de collaboration.", "Collecter données, patterns et perspectives diverses.", "Choisir une cause contrôlable à traiter.", "Définir une petite expérience avec propriétaire, mesure et date de revue."], "Synthèse anonymisée et une à trois expériences d’amélioration.", ["Pas de blâme individuel.", "Les actions sont petites et mesurables.", "Les actions précédentes sont revues."]),
            ("release-planning", "Préparer une release sûre, observable et réversible.", ["Définir scope, critères d’entrée/sortie, dépendances et fenêtre.", "Coordonner tests, données, sécurité, opérations, support et communication.", "Concevoir rollout progressif, monitoring, rollback et responsabilités.", "Exécuter go/no-go puis vérifier résultats et incidents post-release."], "Release plan, checklist, RACI, communication, rollback et validation.", ["Rollback testé ou procédure crédible.", "Métriques et alertes prêtes avant release.", "Le go/no-go a des critères objectifs."]),
        ],
    },
    {
        "slug": "ibm-agentic-change-manager",
        "id": "builtin-ibm-agentic-change-manager",
        "name": "Change Manager",
        "icon": "change",
        "role": "Change Manager",
        "description": "Planifie les impacts humains d’une transformation, traite les résistances et mesure l’adoption durable.",
        "workflow": "Transformation → impacts → stakeholders → readiness → choix framework → résistances → communication → formation → adoption → KPI",
        "default_prompts": ["Analyse les impacts et la readiness de ce changement.", "Prépare le plan de communication et de formation.", "Construis le plan d’adoption et ses KPI."],
        "sources": COMMON_SOURCES + [
            ("Prosci ADKAR", "https://www.prosci.com/methodology/adkar", "Source officielle du modèle ADKAR ; méthode propriétaire à référencer sans recopier ses supports."),
            ("Kotter 8 Steps", "https://www.kotterinc.com/methodology/8-steps/", "Source officielle de la méthode Kotter ; méthode propriétaire à référencer sans reproduire ses supports."),
        ],
        "skills": [
            ("change-impact-analysis", "Évaluer précisément ce qui change pour chaque population.", ["Définir état actuel, état futur, date et périmètre.", "Analyser processus, rôles, comportements, compétences, outils, données et contrôles.", "Évaluer ampleur, fréquence, complexité, sentiment et risque.", "Définir actions de mitigation et responsables par impact."], "Matrice impacts-populations et plan de mitigation.", ["Les impacts sont décrits du point de vue utilisateur.", "Les populations indirectes sont incluses.", "Chaque impact élevé a une action."]),
            ("stakeholder-mapping", "Cartographier influence, impact, position et réseau du changement.", ["Identifier sponsor, coalition, managers, champions, utilisateurs et opposants.", "Évaluer pouvoir, impact, engagement actuel et attendu.", "Comprendre réseaux informels et boucles de feedback.", "Définir stratégie, message, cadence et propriétaire."], "Stakeholder map et engagement plan segmenté.", ["Les positions sont réévaluées dans le temps.", "Les données sensibles restent protégées.", "Sponsor et managers ont des actions concrètes."]),
            ("change-readiness", "Mesurer la capacité et la volonté de réussir le changement.", ["Définir dimensions organisation, leadership, culture, capacité et technologie.", "Collecter preuves quantitatives et qualitatives par segment.", "Établir baseline, zones à risque et facteurs favorables.", "Recommander conditions de lancement et interventions."], "Readiness assessment, heatmap et conditions de passage.", ["La readiness n’est pas une moyenne unique.", "Les scores ont des preuves.", "Les limites de l’échantillon sont visibles."]),
            ("ADKAR", "Utiliser ADKAR comme grille de diagnostic individuel et collectif.", ["Identifier le résultat de changement attendu et les populations.", "Évaluer où se situe le principal obstacle dans la progression ADKAR.", "Choisir interventions adaptées au diagnostic plutôt qu’un plan générique.", "Mesurer progression et renforcer les nouveaux comportements."], "Diagnostic ADKAR par segment et plan d’intervention.", ["Référencer la source officielle pour toute adaptation méthodologique.", "Ne pas reproduire de contenu Prosci propriétaire.", "Le diagnostic repose sur des observations."]),
            ("Kotter", "Utiliser les huit étapes de Kotter comme grille de transformation organisationnelle.", ["Évaluer urgence, coalition et vision de changement.", "Examiner mobilisation, suppression des obstacles et résultats précoces.", "Planifier accélération et ancrage organisationnel.", "Adapter la séquence au contexte en conservant les dépendances critiques."], "Diagnostic Kotter et roadmap de mobilisation.", ["Référencer la source officielle.", "Ne pas copier de supports propriétaires.", "Les résultats rapides renforcent la vision sans la remplacer."]),
            ("resistance-analysis", "Transformer les signaux de résistance en causes traitables.", ["Collecter comportements, verbatims, données d’usage et contexte.", "Distinguer opposition, fatigue, manque de capacité, perte perçue et défaut de compréhension.", "Segmenter causes, influence et risque sans étiqueter les personnes.", "Choisir écoute, co-conception, clarification, support ou escalade."], "Resistance log anonymisé, causes, réponses et signaux de suivi.", ["Ne pas pathologiser la résistance.", "Les causes systémiques sont considérées.", "Les réponses sont proportionnées et éthiques."]),
            ("communication-plan", "Orchestrer des communications ciblées qui permettent l’action.", ["Segmenter audiences par impact et besoin.", "Définir objectif, message, émetteur crédible, canal, moment et call to action.", "Coordonner répétition, localisation, accessibilité et feedback.", "Mesurer compréhension et comportement, pas seulement ouverture."], "Matrice de communication, calendrier, messages et métriques.", ["Le message répond à ce qui change pour moi.", "Les managers disposent de kits et réponses.", "Les canaux sont accessibles."]),
            ("training-plan", "Concevoir un apprentissage basé sur les tâches et la performance.", ["Relier impacts à compétences et populations.", "Définir objectifs observables, prérequis et parcours.", "Choisir pratique, simulation, aide en situation et support post-formation.", "Mesurer acquisition, transfert au poste et performance."], "Training needs analysis, curriculum, calendrier, supports et évaluation.", ["Formation et communication ne sont pas confondues.", "Les apprenants pratiquent des tâches réelles.", "Le support continue après la session."]),
            ("adoption-plan", "Faire passer de l’activation initiale à l’usage durable.", ["Définir comportements cibles et segments.", "Aligner sponsor, managers, champions, support et processus.", "Planifier pilotes, onboarding, nudges, office hours et renforcement.", "Suivre adoption, qualité, friction et bénéfices puis adapter."], "Adoption roadmap, interventions, propriétaires et boucle d’apprentissage.", ["Adoption ne se réduit pas aux connexions.", "Les comportements cibles sont mesurables.", "Le plan inclut désapprentissage et retrait de l’ancien monde."]),
            ("change-kpi", "Mesurer préparation, adoption, maîtrise et résultats du changement.", ["Construire une chaîne activité → compréhension → comportement → résultat.", "Définir formules, segments, baseline, cible et sources.", "Ajouter guardrails sur charge, équité, qualité et contournements.", "Fixer cadence, propriétaire et décision associée à chaque seuil."], "Scorecard changement et dictionnaire KPI.", ["Séparer leading et lagging indicators.", "Les métriques ne pénalisent pas la remontée de problèmes.", "Les bénéfices métier restent reliés à l’adoption."]),
        ],
    },
    {
        "slug": "ibm-agentic-solution-architect",
        "id": "builtin-ibm-agentic-solution-architect",
        "name": "Solution Architect",
        "icon": "architecture",
        "role": "Solution Architect",
        "description": "Conçoit une architecture cible traçable depuis les exigences, avec arbitrages sécurité, intégration, résilience, cloud et coût.",
        "workflow": "Besoins → FR/NFR → contraintes → drivers → options → trade-offs → architecture cible → sécurité/résilience/coût → review → roadmap",
        "default_prompts": ["Extrais FR, NFR, contraintes et drivers d’architecture.", "Compare les options et dessine l’architecture cible C4.", "Réalise la review sécurité, résilience et coût."],
        "sources": COMMON_SOURCES + [
            ("C4 model", "https://c4model.com/", "Modèle de diagrammes logiciels sous licence Creative Commons Attribution 4.0."),
            ("OpenAPI Specification", "https://spec.openapis.org/oas/latest.html", "Spécification officielle actuelle pour la description d’API HTTP."),
            ("NIST Cybersecurity Framework 2.0", "https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20", "Cadre officiel de gestion du risque cybersécurité."),
            ("OWASP ASVS", "https://owasp.org/www-project-application-security-verification-standard/", "Base ouverte de vérification des contrôles de sécurité applicatifs."),
            ("Architecture Decision Records", "https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions", "Article original de Michael Nygard sur les ADR."),
            ("FinOps Framework", "https://www.finops.org/framework/", "Cadre ouvert de collaboration et décision pour la valeur cloud."),
        ],
        "skills": [
            ("requirements-analysis", "Transformer les besoins en exigences fonctionnelles traçables.", ["Identifier acteurs, capacités, événements, données et règles.", "Distinguer besoin, exigence, contrainte, hypothèse et solution proposée.", "Rendre les exigences atomiques et testables.", "Maintenir traçabilité vers objectifs, scénarios et décisions."], "Catalogue FR, contexte, cas d’usage et matrice de traçabilité.", ["Aucune exigence sans source.", "Les ambiguïtés deviennent questions ouvertes.", "Les conflits ont une décision explicite."]),
            ("NFR", "Définir des attributs qualité mesurables et vérifiables.", ["Éliciter performance, disponibilité, sécurité, confidentialité, accessibilité, maintenabilité et exploitation.", "Formuler stimulus, contexte, réponse et mesure.", "Fixer seuil, percentile, fenêtre et conditions de charge.", "Relier NFR aux tests, observabilité et capacité."], "Catalogue NFR priorisé et scénarios de qualité.", ["Éviter rapide, scalable ou sécurisé sans métrique.", "Les objectifs et limites sont distingués.", "Chaque NFR possède une méthode de vérification."]),
            ("architecture-drivers", "Prioriser les forces qui structurent réellement l’architecture.", ["Collecter objectifs métier, NFR critiques, contraintes, risques et principes.", "Évaluer impact, volatilité et pouvoir discriminant.", "Retenir un petit ensemble de drivers dominants.", "Tester chaque option contre ces drivers."], "Driver map priorisée avec implications architecturales.", ["Les drivers ne sont pas une copie de toutes les exigences.", "Les conflits sont visibles.", "La priorité est validée par les décideurs."]),
            ("tradeoff-analysis", "Comparer les options avec critères, preuves et coûts de renoncement.", ["Définir options réellement distinctes, y compris statu quo.", "Choisir critères pondérés issus des drivers.", "Évaluer bénéfices, risques, complexité, réversibilité et coût.", "Effectuer sensibilité et consigner la décision."], "Matrice de trade-offs, sensibilité et recommandation.", ["Pas de score sans justification.", "Les incertitudes sont indiquées.", "Les conséquences négatives du choix sont assumées."]),
            ("solution-architecture", "Composer la vue cible, ses responsabilités et sa roadmap.", ["Définir contexte, frontières, acteurs et systèmes externes.", "Décomposer capacités, services, données, interactions et déploiement.", "Tracer exigences et drivers vers composants et décisions.", "Décrire transition, opérations, risques et points de validation."], "Dossier d’architecture cible, vues, décisions, risques et roadmap.", ["Cohérence entre vues logique, données, intégration et déploiement.", "Les composants ont des responsabilités nettes.", "La solution est opérable et testable."]),
            ("integration", "Concevoir les échanges entre systèmes avec contrats et modes de défaillance.", ["Inventorier producteurs, consommateurs, données, fréquences et criticité.", "Choisir sync, async, batch ou event selon drivers.", "Définir contrat, idempotence, ordre, retries, timeout et reprise.", "Prévoir observabilité, sécurité, versionnement et ownership."], "Integration catalog, séquences, contrats et gestion d’erreurs.", ["Les pannes partielles sont couvertes.", "Les systèmes de référence sont explicites.", "Chaque interface a un propriétaire."]),
            ("API", "Concevoir une API cohérente, sécurisée et évolutive.", ["Partir des capacités et cas d’usage consommateurs.", "Définir ressources/opérations, schémas, erreurs, pagination et idempotence.", "Spécifier authn/authz, quotas, versionnement et compatibilité.", "Documenter en OpenAPI et tester exemples et contrats."], "Contrat OpenAPI, conventions, exemples et stratégie de cycle de vie.", ["Le contrat est valide et testable.", "Les erreurs sont stables et actionnables.", "Aucun secret ni donnée sensible dans les exemples."]),
            ("security", "Intégrer la sécurité par menace, contrôle et preuve.", ["Définir actifs, frontières de confiance, acteurs et obligations.", "Modéliser menaces, abus et risques.", "Sélectionner contrôles prévention, détection, réponse et récupération.", "Relier contrôles à exigences, tests, journalisation et responsables."], "Threat model, exigences, matrice de contrôles et risques résiduels.", ["Moindre privilège et défense en profondeur.", "Les données sont classifiées sur tout leur cycle.", "Les risques résiduels ont un approbateur."]),
            ("cloud", "Choisir et structurer les services cloud selon les drivers et garde-fous.", ["Confirmer modèle de responsabilité, régions, contraintes et compétences.", "Comparer services gérés, portabilité, dépendance et exploitation.", "Concevoir comptes/subscriptions, réseau, identité, données et observabilité.", "Vérifier capacités, limites et tarifs dans les sources fournisseur actuelles."], "Landing-zone view, service map, décisions cloud et garde-fous.", ["Aucun service supposé disponible sans vérification récente.", "Les limites régionales et quotas sont considérés.", "Le choix minimise la charge opérationnelle totale."]),
            ("resilience", "Concevoir la continuité face aux pannes réalistes.", ["Définir services critiques, SLO, RTO, RPO et dépendances.", "Modéliser zones de panne et scénarios de défaillance.", "Choisir redondance, isolation, dégradation, sauvegarde et reprise.", "Planifier tests de restauration, game days et observabilité."], "Resilience model, scénarios, patterns, runbooks et plan de test.", ["Backup n’implique pas restauration prouvée.", "Les dépendances tierces sont incluses.", "Le coût est proportionné à la criticité."]),
            ("cost-analysis", "Estimer et optimiser le coût complet sans compromettre les drivers.", ["Définir unités de demande et hypothèses de charge.", "Modéliser compute, stockage, réseau, licences, support et opérations.", "Comparer scénarios de croissance et engagements.", "Définir allocation, budgets, alertes et leviers FinOps."], "Modèle de coût, hypothèses, sensibilités et plan d’optimisation.", ["Tarifs et devises datés et sourcés.", "Inclure coûts de migration et d’exploitation.", "L’optimisation ne viole pas les SLO ou la sécurité."]),
            ("ADR", "Consigner une décision d’architecture et ses conséquences.", ["Donner titre de décision et statut.", "Décrire contexte, drivers et contraintes.", "Lister options considérées et décision avec rationnel.", "Documenter conséquences positives, négatives et déclencheurs de revue."], "ADR court, versionné et relié aux exigences et vues.", ["Une décision principale par ADR.", "Les alternatives rejetées sont conservées.", "Le statut et la date sont explicites."]),
            ("C4", "Communiquer l’architecture aux bons niveaux avec le modèle C4.", ["Commencer par System Context et audience.", "Ajouter Container pour les responsabilités et technologies majeures.", "Créer Component seulement si utile à une audience technique.", "Nommer éléments par fonction et relations par verbes, avec légende."], "Diagrammes C4 source et rendus avec descriptions et portée.", ["Un niveau d’abstraction cohérent par vue.", "Chaque élément et relation est nommé.", "Le diagramme reste lisible sans narration orale."]),
            ("architecture-review", "Évaluer une architecture contre exigences, drivers et risques.", ["Fixer périmètre, maturité, critères et preuves attendues.", "Rejouer scénarios fonctionnels, qualité, sécurité, panne et exploitation.", "Vérifier cohérence des vues, décisions et roadmap.", "Classer constats, risque, recommandation, propriétaire et échéance."], "Review report avec verdict, risques, actions et décisions requises.", ["Les constats citent une preuve.", "Bloquants séparés des améliorations.", "Le verdict est conditionné à des critères mesurables."]),
        ],
    },
]


def clean(value: str) -> str:
    return textwrap.dedent(value).strip()


def skill_slug(name: str) -> str:
    return name.lower()


def skill_body(role: dict, item: tuple) -> str:
    name, summary, method, deliverable, checks = item
    method_lines = "\n".join(
        f"{index}. {step}" for index, step in enumerate(method, 1)
    )
    check_lines = "\n".join(f"- {check}" for check in checks)
    return f"""# {name}

Utiliser ce skill pour {summary[0].lower() + summary[1:]}

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

{method_lines}

## Livrable

{deliverable}

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

{check_lines}
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.""".strip()


def root_body(role: dict) -> str:
    skill_names = [skill_slug(item[0]) for item in role["skills"]]
    return clean(f"""
    # {role['name']}

    Agir comme un {role['role']} senior dans un contexte d’entreprise IBM ou comparable. Piloter le workflow complet sans sauter les validations qui protègent la décision, l’utilisateur, la conformité ou la livraison.

    ## Workflow de référence

    `{role['workflow']}`

    ## Routage des skills

    Skills disponibles : {', '.join(f'`{name}`' for name in skill_names)}.

    1. Identifier la phase actuelle, la décision attendue et le livrable.
    2. Lire le fichier `skills/<skill>/SKILL.md` correspondant avant d’exécuter cette phase.
    3. Enchaîner plusieurs skills seulement si leurs sorties servent réellement l’étape suivante.
    4. Conserver un journal léger des preuves, hypothèses, décisions, risques et questions ouvertes.
    5. Terminer par le contrôle qualité ou la review prévu dans le workflow.

    ## Principes d’exécution

    - Commencer par les résultats utilisateur et métier, puis choisir la méthode minimale suffisante.
    - Séparer les faits sourcés, les estimations, les hypothèses et les recommandations.
    - Préférer les sources primaires ; vérifier en ligne tout standard, tarif, réglementation ou capacité susceptible d’avoir changé.
    - Protéger les informations confidentielles et personnelles. Ne pas envoyer de document vers un service externe sans autorisation.
    - Ne jamais fabriquer une citation, un score, un résultat de recherche, une conformité, un engagement client ou une approbation.
    - Rendre les arbitrages, les limites et les désaccords visibles.
    - Produire des livrables éditables et accessibles, avec sources et traçabilité.
    - Répondre dans la langue de l’utilisateur ; conserver les noms officiels des cadres et fournir une traduction explicative si nécessaire.

    ## IBM et propriété intellectuelle

    S’appuyer sur IBM Enterprise Design Thinking et IBM Garage lorsque pertinent, en revenant aux pages officielles listées dans `references/sources.md`. Les noms ADKAR, Kotter, C4, Scrum, RICE et autres cadres restent la propriété de leurs détenteurs. Ce bundle fournit une pratique originale et des liens ; il ne copie pas leurs supports propriétaires et ne prétend pas être un produit officiel IBM.

    ## Définition de terminé

    Un travail est terminé lorsque le livrable répond à la décision, cite ses sources, expose hypothèses et limites, passe les contrôles du skill, identifie les risques résiduels et propose une prochaine action vérifiable.
    """)


def source_markdown(role: dict) -> str:
    rows = []
    seen = set()
    for title, url, use in role["sources"]:
        if url in seen:
            continue
        seen.add(url)
        rows.append(f"- [{title}]({url}) — {use}")
    source_rows = "\n".join(rows)
    return f"""# Sources officielles — {role['name']}

Ces liens sont des points d’ancrage, pas une copie locale de leurs contenus. Quand une réponse dépend d’une version, d’un critère, d’un tarif, d’une réglementation ou d’une capacité actuelle, ouvrir la source primaire, noter la date de consultation et citer la version utilisée.

{source_rows}

## Règles de fraîcheur

- Normes, lois, sécurité, produits cloud et prix : vérifier à chaque utilisation importante.
- Cadres stables : vérifier si la version ou la terminologie influence le livrable.
- En cas d’indisponibilité réseau : indiquer la dernière source connue et marquer toute affirmation temporelle comme non vérifiée.
- Ne pas présenter Bob Work, ce plugin ou ses livrables comme officiellement approuvés par IBM ou par les organismes cités.""".strip()


DELIVERABLE_CONTRACT = clean("""
# Contrat commun de livraison

## En-tête

- objectif et décision attendue ;
- audience, périmètre, date et version ;
- propriétaire et contributeurs ;
- niveau de confidentialité si connu.

## Corps

- résumé décisionnel ;
- faits et preuves avec sources ;
- analyse et options ;
- recommandation et rationnel ;
- hypothèses, limites, risques et dépendances ;
- actions, responsables, échéances et critères de succès.

## Traçabilité

Utiliser des identifiants stables pour relier exigences, insights, décisions, risques, actions et artefacts. Une estimation doit préciser son unité, son horizon et sa base. Une information externe susceptible d’évoluer doit préciser sa source et sa date de consultation.

## Revue avant livraison

Contrôler exactitude, complétude, cohérence, confidentialité, accessibilité, lisibilité et absence de contenu inventé. Signaler explicitement ce qui n’a pas été vérifié. Pour un fichier généré, vérifier qu’il s’ouvre et fournir son chemin ou son lien de téléchargement.
""")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def build_role(role: dict) -> None:
    plugin_dir = PLUGINS / role["slug"]
    if plugin_dir.exists():
        for child in plugin_dir.iterdir():
            if child.name not in {".codex-plugin", "skills"}:
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
    plugin_dir.mkdir(parents=True, exist_ok=True)

    body = root_body(role)
    plugin_json = {
        "name": role["slug"],
        "version": VERSION,
        "description": role["description"],
        "author": {"name": "Bob Work"},
        "license": "Proprietary",
        "keywords": ["agentic", "ibm", "enterprise", role["role"].lower()],
        "skills": "./skills/",
        "interface": {
            "displayName": role["name"],
            "shortDescription": role["description"][:64],
            "longDescription": f"{role['description']} Workflow : {role['workflow']}.",
            "developerName": "Bob Work",
            "category": "Business",
            "capabilities": ["Analyze", "Plan", "Write", "Review"],
            "brandColor": "#0F62FE",
            "defaultPrompt": role["default_prompts"],
        },
    }
    write_text(plugin_dir / ".codex-plugin/plugin.json", json.dumps(plugin_json, ensure_ascii=False, indent=2))

    resources = [
        {"kind": "web-reference", "label": title, "url": url, "optional": True}
        for title, url, _ in role["sources"]
    ]
    manifest = {
        "schemaVersion": 1,
        "builtin": True,
        "agentic": True,
        "name": role["name"],
        "slug": role["slug"],
        "version": VERSION,
        "author": "Bob Work",
        "description": role["description"],
        "category": "recipe",
        "icon": role["icon"],
        "permissions": [{"type": "file.read"}, {"type": "file.write"}, {"type": "network.request"}],
        "capabilities": ["workflow.orchestration", "evidence.traceability", "artifact.create", "quality.review"],
        "skills": [{"name": skill_slug(item[0]), "displayName": item[0], "description": item[1], "path": f"skills/{skill_slug(item[0])}/SKILL.md"} for item in role["skills"]],
        "resources": resources,
        "specializedMode": {
            "label": role["name"],
            "description": role["description"],
            "workflow": role["workflow"],
            "allowedSkills": [skill_slug(item[0]) for item in role["skills"]],
            "allowedTools": ["read_file", "write_file", "web_fetch", "web_search"],
            "inputExtensions": ["md", "txt", "pdf", "docx", "pptx", "xlsx", "csv", "png", "jpg", "jpeg"],
            "outputFormats": ["md", "json", "csv", "docx", "pptx", "xlsx", "pdf", "svg", "png"],
            "sandbox": "enterprise-advisory",
        },
        "instructions": body,
        "releaseNotes": f"{VERSION} — Première version built-in : orchestrateur {role['role']} et {len(role['skills'])} skills spécialisés avec sources et contrôles qualité.",
    }
    write_text(plugin_dir / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    frontmatter = f'---\nname: {role["slug"]}\ndescription: "{role["description"].replace(chr(34), chr(39))}"\nicon: {role["icon"]}\n---\n\n'
    write_text(plugin_dir / "SKILL.md", frontmatter + body)
    write_text(plugin_dir / "references/sources.md", source_markdown(role))
    write_text(plugin_dir / "references/deliverable-contract.md", DELIVERABLE_CONTRACT)
    write_text(
        plugin_dir / "agents/openai.yaml",
        f'interface:\n  display_name: "{role["name"]}"\n  short_description: "{role["description"][:60]}"\n  brand_color: "#0F62FE"\n  default_prompt: "Use ${role["slug"]} to {role["default_prompts"][0][0].lower() + role["default_prompts"][0][1:]}"\npolicy:\n  allow_implicit_invocation: true',
    )

    skills_dir = plugin_dir / "skills"
    if skills_dir.exists():
        shutil.rmtree(skills_dir)
    for item in role["skills"]:
        skill_name, summary, *_ = item
        slug = skill_slug(skill_name)
        skill_dir = skills_dir / slug
        skill_frontmatter = f'---\nname: {slug}\ndescription: "{summary.replace(chr(34), chr(39))}"\nicon: {role["icon"]}\n---\n\n'
        write_text(skill_dir / "SKILL.md", skill_frontmatter + skill_body(role, item))
        write_text(
            skill_dir / "agents/openai.yaml",
            f'interface:\n  display_name: "{skill_name}"\n  short_description: "{summary[:60]}"\n  brand_color: "#0F62FE"\n  default_prompt: "Use ${slug} to {summary[0].lower() + summary[1:]}"\npolicy:\n  allow_implicit_invocation: true',
        )


def validate_generated_role(role: dict) -> None:
    plugin_dir = PLUGINS / role["slug"]
    manifest = json.loads((plugin_dir / "manifest.json").read_text(encoding="utf-8"))
    description = (manifest.get("description") or "").strip()
    if len(description) < 80:
        raise ValueError(f"{role['slug']}: description is missing or too short")
    if "Agentic" in (manifest.get("name") or ""):
        raise ValueError(f"{role['slug']}: display name still contains Agentic")
    if manifest.get("icon") != role["icon"]:
        raise ValueError(f"{role['slug']}: unexpected icon {manifest.get('icon')}")
    if len(manifest.get("skills", [])) != len(role["skills"]):
        raise ValueError(f"{role['slug']}: manifest skill count mismatch")
    for skill in manifest["skills"]:
        path = plugin_dir / skill["path"]
        if not path.is_file():
            raise ValueError(f"{role['slug']}: missing {skill['path']}")
        content = path.read_text(encoding="utf-8")
        if "icon:" not in content.split("---", 2)[1]:
            raise ValueError(f"{role['slug']}: missing icon in {skill['path']}")
        if "\n    ##" in content or "\n    # " in content:
            raise ValueError(f"{role['slug']}: indented Markdown heading in {skill['path']}")
        for heading in ("## Entrées minimales", "## Méthode", "## Livrable", "## Contrôles qualité", "## Ressources"):
            if heading not in content:
                raise ValueError(f"{role['slug']}: missing {heading} in {skill['path']}")
    sources = (plugin_dir / "references/sources.md").read_text(encoding="utf-8")
    if not sources.startswith("# Sources officielles") or "\n    ##" in sources:
        raise ValueError(f"{role['slug']}: malformed source registry")


def build_archive() -> None:
    if ARCHIVE.exists():
        ARCHIVE.unlink()
    with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for role in sorted(ROLE_SPECS, key=lambda item: item["slug"]):
            plugin_dir = PLUGINS / role["slug"]
            for path in sorted(plugin_dir.rglob("*")):
                if not path.is_file():
                    continue
                relative = Path(role["slug"]) / path.relative_to(plugin_dir)
                info = zipfile.ZipInfo(relative.as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, path.read_bytes())


def main() -> None:
    for role in ROLE_SPECS:
        build_role(role)
        validate_generated_role(role)
    write_text(
        ROOT / "README.md",
        "# IBM-aligned agentic profession plugins\n\nSeven Bob Work built-in plugins generated by `build_catalog.py`. The methods are original operational guidance. IBM and third-party frameworks are referenced through official links and are not bundled or presented as endorsements.\n",
    )
    build_archive()
    print(f"Built {len(ROLE_SPECS)} plugins in {ARCHIVE} ({ARCHIVE.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
