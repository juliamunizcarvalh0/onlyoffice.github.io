/*
 * (c) Copyright Ascensio System SIA 2010-2025
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

(function(){
	let func = new RegisteredFunction({
		"name": "checkCitations",
		"text": "Check Citations and References",
		"description": "Checks that every in-text citation in the document has a matching entry in the reference list (References, Referências, Bibliografia, Bibliography, Works Cited) and that every reference is cited in the text. Finds missing references, uncited references and mismatched years or author names, and adds a comment to each problem. Use it when the user asks to check, review or validate citations, references or the bibliography of a document. It never changes the user's text.",
		"parameters": {
			"type": "object",
			"properties": {
				"useAI": {
					"type": "boolean",
					"description": "Whether to ask the AI model to explain each problem and suggest a fix. If false, only the automatic check is done.",
					"default": true
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Check the citations in this document",
				"arguments": {}
			},
			{
				"prompt": "Are there references missing from my bibliography?",
				"arguments": {}
			},
			{
				"prompt": "Verifique se todas as citações estão nas referências",
				"arguments": {}
			},
			{
				"prompt": "Quick citation check without AI",
				"arguments": { "useAI": false }
			}
		]
	});

	// ---------------------------------------------------------------------
	// Pure helpers (run in the plugin context, not inside callCommand)
	// ---------------------------------------------------------------------

	const COMMENT_PREFIX = "[Citations] ";

	const REFERENCE_HEADINGS = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:refer[eê]ncias(?:\s+bibliogr[aá]ficas)?|references|reference\s+list|bibliograph(?:y|ies)|bibliografia|works\s+cited|literature\s+cited|obras\s+citadas)\s*:?$/i;

	const YEAR_REGEX = /\b(1[5-9]\d{2}|20\d{2})([a-z])?\b/;
	const NAME_STOP_WORDS = ["et", "al", "e", "and", "apud", "cf", "p", "pp", "ver", "see", "in", "op", "cit", "ibid", "idem", "s.d", "n.d", "org", "orgs", "ed", "eds"];

	function normalize(str) {
		return (str || "")
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase();
	}

	function findReferenceHeading(paragraphs) {
		// The last matching heading wins: a table of contents may also list "References"
		for (let i = paragraphs.length - 1; i >= 0; i--) {
			let t = (paragraphs[i] || "").trim();
			if (t.length > 0 && t.length < 60 && REFERENCE_HEADINGS.test(t))
				return i;
		}
		return -1;
	}

	function getSurnames(chunk) {
		let words = chunk.split(/[\s,;&]+/);
		let result = [];
		for (let w of words) {
			let clean = w.replace(/[^\p{L}'-]/gu, "");
			if (clean.length < 2)
				continue;
			if (NAME_STOP_WORDS.indexOf(normalize(clean)) !== -1)
				continue;
			if (!/^\p{Lu}/u.test(clean))
				continue;
			result.push(clean);
		}
		return result;
	}

	// Extracts author-date citations: "(Silva, 2020)", "(SILVA; SOUZA, 2019, p. 3)",
	// "(Silva et al., 2020a; Costa, 2018)" and narrative "Silva (2020)".
	function extractAuthorDateCitations(bodyText) {
		let citations = [];
		let seen = {};

		function add(label, surnames, year) {
			if (!surnames.length || !year)
				return;
			let key = normalize(surnames[0]) + "|" + year;
			if (seen[key])
				return;
			seen[key] = true;
			citations.push({ label: label, surnames: surnames, year: year });
		}

		let parenRegex = /\(([^()]{3,200})\)/g;
		let m;
		while ((m = parenRegex.exec(bodyText)) !== null) {
			let inner = m[1];
			if (!YEAR_REGEX.test(inner))
				continue;
			for (let part of inner.split(";")) {
				let ym = part.match(YEAR_REGEX);
				if (!ym)
					continue;
				let before = part.substring(0, ym.index);
				let surnames = getSurnames(before);
				// Only the full parenthesis can be found in the text later
				add(m[0], surnames, ym[1] + (ym[2] || ""));
			}
		}

		let narrativeRegex = /(\p{Lu}[\p{L}'-]+(?:\s+(?:et\s+al\.?|e|and|&)\s*(?:\p{Lu}[\p{L}'-]+)?)?)\s*\((1[5-9]\d{2}|20\d{2})([a-z])?(?:,[^)]*)?\)/gu;
		while ((m = narrativeRegex.exec(bodyText)) !== null) {
			let surnames = getSurnames(m[1]);
			add(m[0], surnames, m[2] + (m[3] || ""));
		}

		return citations;
	}

	// Extracts numeric citations: "[1]", "[2, 5]", "[3-6]"
	function extractNumericCitations(bodyText) {
		let result = [];
		let regex = /\[(\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)\]/g;
		let m;
		while ((m = regex.exec(bodyText)) !== null) {
			let numbers = [];
			for (let part of m[1].split(",")) {
				let range = part.split(/[-–]/).map(function(s) { return parseInt(s, 10); });
				if (range.length === 2 && range[1] >= range[0] && range[1] - range[0] < 50) {
					for (let n = range[0]; n <= range[1]; n++)
						numbers.push(n);
				} else if (!isNaN(range[0])) {
					numbers.push(range[0]);
				}
			}
			result.push({ label: m[0], numbers: numbers });
		}
		return result;
	}

	function analyzeAuthorDate(citations, references) {
		let normRefs = references.map(normalize);
		let cited = references.map(function() { return false; });
		let problems = [];

		for (let c of citations) {
			let surname = normalize(c.surnames[0]);
			let year = c.year.substring(0, 4);
			let fullYear = normalize(c.year); // keeps the letter: "2020a"
			let exact = -1;
			let sameYear = -1;
			let sameAuthor = -1;
			for (let i = 0; i < normRefs.length; i++) {
				if (normRefs[i].indexOf(surname) === -1)
					continue;
				// Same author with works in the same year ("2020a", "2020b"):
				// the reference with the same letter is the exact match
				if (fullYear !== year && normRefs[i].indexOf(fullYear) !== -1) {
					exact = i;
					break;
				}
				if (sameYear === -1 && normRefs[i].indexOf(year) !== -1)
					sameYear = i;
				if (sameAuthor === -1)
					sameAuthor = i;
			}
			if (exact === -1)
				exact = sameYear;

			if (exact !== -1) {
				cited[exact] = true;
			} else if (sameAuthor !== -1) {
				cited[sameAuthor] = true;
				problems.push({
					kind: "yearMismatch",
					citation: c.label,
					reference: sameAuthor,
					detail: "The citation " + c.label + " has year " + c.year + ", but the matching reference by " + c.surnames[0] + " has a different year."
				});
			} else {
				problems.push({
					kind: "missingReference",
					citation: c.label,
					reference: -1,
					detail: "The citation " + c.label + " has no matching entry in the reference list."
				});
			}
		}

		for (let i = 0; i < references.length; i++) {
			if (!cited[i]) {
				problems.push({
					kind: "uncitedReference",
					citation: "",
					reference: i,
					detail: "This reference is never cited in the text."
				});
			}
		}
		return problems;
	}

	function analyzeNumeric(citations, references) {
		let cited = references.map(function() { return false; });
		let problems = [];
		let reported = {};
		for (let c of citations) {
			for (let n of c.numbers) {
				if (n >= 1 && n <= references.length) {
					cited[n - 1] = true;
				} else if (!reported[n]) {
					reported[n] = true;
					problems.push({
						kind: "missingReference",
						citation: c.label,
						reference: -1,
						detail: "The citation " + c.label + " points to reference number " + n + ", but the reference list has only " + references.length + " entries."
					});
				}
			}
		}
		for (let i = 0; i < references.length; i++) {
			if (!cited[i]) {
				problems.push({
					kind: "uncitedReference",
					citation: "",
					reference: i,
					detail: "Reference [" + (i + 1) + "] is never cited in the text."
				});
			}
		}
		return problems;
	}

	function parseJsonFromModel(answer) {
		if (!answer || typeof answer !== "string")
			return null;
		let cleaned = answer.replace(/```(?:json)?/gi, "");
		let start = cleaned.indexOf("{");
		let end = cleaned.lastIndexOf("}");
		if (start === -1 || end <= start)
			return null;
		try {
			return JSON.parse(cleaned.substring(start, end + 1));
		} catch (e) {
			return null;
		}
	}

	function buildPrompt(problems, references) {
		let refList = references.map(function(r, i) { return "[" + i + "] " + r; }).join("\n");
		let problemList = problems.map(function(p, i) {
			return i + ". " + p.kind + (p.citation ? " | citation: " + p.citation : "") + (p.reference >= 0 ? " | reference index: " + p.reference : "") + " | " + p.detail;
		}).join("\n");

		return "You are an academic citation reviewer. An automatic check compared the in-text citations of a document with its reference list and found the problems below. " +
			"For each problem, write one short comment (at most 40 words) for the author: confirm the problem or say it is probably a false alarm (for example, a different spelling of the same author), and give a concrete fix. " +
			"Also look at the reference list and report entries whose formatting is inconsistent with the others (author format, year position, punctuation). " +
			"Write the comments in the same language as the reference list. Do not rewrite the document. " +
			"Reply only with JSON in this exact format: {\"comments\": [{\"problem\": 0, \"comment\": \"...\", \"falseAlarm\": false}], \"styleIssues\": [{\"reference\": 0, \"comment\": \"...\"}]}\n\n" +
			"Problems:\n" + problemList + "\n\nReference list:\n" + refList;
	}

	// ---------------------------------------------------------------------
	// Tool entry point
	// ---------------------------------------------------------------------

	func.call = async function(params) {
		let useAI = params.useAI !== false;

		let paragraphs = await Asc.Editor.callCommand(function(){
			let doc = Api.GetDocument();
			let pars = doc.GetAllParagraphs();
			let result = [];
			for (let i = 0; i < pars.length; i++)
				result.push(pars[i].GetText());
			return result;
		});

		if (!paragraphs || !paragraphs.length)
			throw new window.AgentState.ToolError("The document is empty.");

		let headingIndex = findReferenceHeading(paragraphs);
		if (headingIndex === -1)
			throw new window.AgentState.ToolError("No reference list was found. Add a heading such as \"References\" or \"Referências\" before the list of references.");

		let bodyText = paragraphs.slice(0, headingIndex).join("\n");
		let referenceIndexes = [];
		let references = [];
		for (let i = headingIndex + 1; i < paragraphs.length; i++) {
			let t = (paragraphs[i] || "").trim();
			if (t.length < 10)
				continue;
			referenceIndexes.push(i);
			references.push(t);
		}

		if (!references.length)
			throw new window.AgentState.ToolError("The reference list after the heading is empty.");

		let numeric = extractNumericCitations(bodyText);
		let authorDate = extractAuthorDateCitations(bodyText);
		let isNumericStyle = numeric.length > authorDate.length;

		if (!numeric.length && !authorDate.length)
			throw new window.AgentState.ToolError("No citations were found in the text. Supported formats: (Author, 2020), Author (2020) and [1].");

		let problems = isNumericStyle ? analyzeNumeric(numeric, references) : analyzeAuthorDate(authorDate, references);
		let styleIssues = [];

		let requestEngine = null;
		if (useAI && problems.length)
			requestEngine = AI.Request.create(AI.ActionType.Chat);

		let modelName = requestEngine && requestEngine.modelUI ? requestEngine.modelUI.name : "Citation Checker";
		let actionName = "AI (" + modelName + ")";

		await Asc.Editor.callMethod("StartAction", ["Block", actionName]);
		await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

		let isSendedEndLongAction = false;
		async function checkEndAction() {
			if (!isSendedEndLongAction) {
				await Asc.Editor.callMethod("EndAction", ["Block", actionName]);
				isSendedEndLongAction = true;
			}
		}

		if (requestEngine) {
			try {
				let answer = await requestEngine.chatRequest(buildPrompt(problems, references), false);
				let parsed = parseJsonFromModel(answer);
				if (parsed && Array.isArray(parsed.comments)) {
					for (let c of parsed.comments) {
						let p = problems[c.problem];
						if (!p || typeof c.comment !== "string")
							continue;
						if (c.falseAlarm === true)
							p.falseAlarm = true;
						p.detail = c.comment;
					}
				}
				if (parsed && Array.isArray(parsed.styleIssues)) {
					for (let s of parsed.styleIssues) {
						if (typeof s.reference === "number" && s.reference >= 0 && s.reference < references.length && typeof s.comment === "string")
							styleIssues.push({ reference: s.reference, detail: s.comment });
					}
				}
			} catch (e) {
				// If the model fails, keep the automatic messages
			}
		}

		await checkEndAction();

		let toComment = problems.filter(function(p) { return !p.falseAlarm; });

		Asc.scope.items = toComment.map(function(p) {
			return {
				citation: p.citation,
				paragraph: p.reference >= 0 ? referenceIndexes[p.reference] : -1,
				message: COMMENT_PREFIX + p.detail
			};
		}).concat(styleIssues.map(function(s) {
			return {
				citation: "",
				paragraph: referenceIndexes[s.reference],
				message: COMMENT_PREFIX + s.detail
			};
		}));
		Asc.scope.author = modelName;

		let added = await Asc.Editor.callCommand(function(){
			let doc = Api.GetDocument();
			let pars = doc.GetAllParagraphs();
			let count = 0;
			let firstId = null;
			for (let item of Asc.scope.items) {
				let comment = null;
				if (item.citation) {
					let ranges = doc.Search(item.citation, true);
					if (ranges && ranges.length)
						comment = ranges[0].AddComment(item.message, Asc.scope.author, "uid" + Asc.scope.author);
				} else if (item.paragraph >= 0 && pars[item.paragraph]) {
					comment = pars[item.paragraph].AddComment(item.message, Asc.scope.author, "uid" + Asc.scope.author);
				}
				if (comment) {
					count++;
					if (!firstId && comment.GetId)
						firstId = comment.GetId();
				}
			}
			if (firstId)
				doc.ShowComment([firstId]);
			return count;
		});

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);

		let missing = toComment.filter(function(p) { return p.kind === "missingReference"; }).length;
		let uncited = toComment.filter(function(p) { return p.kind === "uncitedReference"; }).length;
		let mismatched = toComment.filter(function(p) { return p.kind === "yearMismatch"; }).length;

		return {
			citationStyle: isNumericStyle ? "numeric" : "author-date",
			citationsFound: isNumericStyle ? numeric.length : authorDate.length,
			referencesFound: references.length,
			missingReferences: missing,
			uncitedReferences: uncited,
			yearMismatches: mismatched,
			formattingIssues: styleIssues.length,
			commentsAdded: added || 0
		};
	};

	return func;
})();
