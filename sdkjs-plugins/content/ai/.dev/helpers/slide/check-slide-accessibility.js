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
		"name": "checkSlideAccessibility",
		"text": "Check Slide Accessibility",
		"description": "Checks the presentation for accessibility problems: images and charts without alternative text, slides without a title, duplicate slide titles, text smaller than 18 pt and slides with too much text. Adds one comment per slide with the problems found and AI suggestions (alt text, title, how to reduce text). Can also write the suggested alt text into the images. Use it when the user asks to check, review or improve the accessibility or readability of the slides.",
		"parameters": {
			"type": "object",
			"properties": {
				"slideNumber": {
					"type": "number",
					"description": "Check only this slide (optional, default all slides).",
					"minimum": 1
				},
				"applyAltText": {
					"type": "boolean",
					"description": "If true, writes the AI-suggested alternative text into images and charts that have none. Default false: only comments are added.",
					"default": false
				},
				"useAI": {
					"type": "boolean",
					"description": "Whether to ask the AI model for suggestions. If false, only the automatic check is done.",
					"default": true
				}
			},
			"required": []
		},
		"examples": [
			{
				"prompt": "Check the accessibility of my presentation",
				"arguments": {}
			},
			{
				"prompt": "Is slide 3 accessible?",
				"arguments": { "slideNumber": 3 }
			},
			{
				"prompt": "Add alt text to all images that are missing it",
				"arguments": { "applyAltText": true }
			},
			{
				"prompt": "Verifique a acessibilidade dos slides",
				"arguments": {}
			}
		]
	});

	// ---------------------------------------------------------------------
	// Rules (based on common WCAG-oriented presentation guidelines)
	// ---------------------------------------------------------------------

	const MIN_FONT_PT = 18;
	const MAX_PARAGRAPHS = 6;
	const MAX_WORDS = 50;
	const COMMENT_PREFIX = "[Accessibility] ";

	// Alt text that is only a file name ("grafico.png") or a default shape name
	// ("Picture 2", "Imagem 1") does not describe the image for screen reader users.
	function isMeaningfulAltText(alt) {
		let t = (alt || "").trim();
		if (!t)
			return false;
		if (/^[^\s\/\\]+\.(png|jpe?g|gif|bmp|svg|webp|tiff?|emf|wmf)$/i.test(t))
			return false;
		if (/^(picture|image|imagem|figura|figure|graphic|gráfico|grafico|chart|foto|photo)\s*\d*$/i.test(t))
			return false;
		return true;
	}

	function normalizeTitle(str) {
		return (str || "").replace(/\s+/g, " ").trim().toLowerCase();
	}

	function findIssues(slides) {
		let titleCount = {};
		for (let s of slides) {
			let t = normalizeTitle(s.title);
			if (t)
				titleCount[t] = (titleCount[t] || 0) + 1;
		}

		let result = [];
		for (let s of slides) {
			let issues = [];
			let t = normalizeTitle(s.title);
			if (!t)
				issues.push({ kind: "noTitle", detail: "The slide has no title. Screen reader users navigate presentations by slide titles." });
			else if (titleCount[t] > 1)
				issues.push({ kind: "duplicateTitle", detail: "The title \"" + s.title.trim() + "\" is used on more than one slide. Each slide should have a unique title." });

			for (let img of s.images) {
				if (!isMeaningfulAltText(img.alt)) {
					let current = (img.alt || "").trim();
					issues.push({ kind: "missingAlt", image: img.drawing, detail: "The " + img.kind + " \"" + (img.name || "unnamed") + "\" " + (current ? "has the alternative text \"" + current + "\", which does not describe the image." : "has no alternative text.") });
				}
			}

			if (s.minFont !== null && s.minFont < MIN_FONT_PT)
				issues.push({ kind: "smallFont", detail: "Some text is " + s.minFont + " pt. Use at least " + MIN_FONT_PT + " pt so it can be read from a distance and on small screens." });

			if (s.paragraphs > MAX_PARAGRAPHS || s.words > MAX_WORDS)
				issues.push({ kind: "tooMuchText", detail: "The slide has " + s.paragraphs + " text blocks and " + s.words + " words. Keep it to " + MAX_PARAGRAPHS + " points and about " + MAX_WORDS + " words, or split it into two slides." });

			if (issues.length)
				result.push({ slide: s.index, issues: issues });
		}
		return result;
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

	function buildPrompt(slidesWithIssues, slidesById) {
		let blocks = slidesWithIssues.map(function(entry) {
			let s = slidesById[entry.slide];
			let images = entry.issues.filter(function(i) { return i.kind === "missingAlt"; }).map(function(i) { return i.image; });
			return "Slide " + entry.slide + "\n" +
				"Title: " + (s.title || "(none)") + "\n" +
				"Text: " + (s.texts.join(" | ").substring(0, 1500) || "(none)") + "\n" +
				"Images without alt text (ids): " + (images.length ? images.join(", ") : "none") + "\n" +
				"Problems: " + entry.issues.map(function(i) { return i.kind; }).join(", ");
		}).join("\n\n");

		return "You are an accessibility reviewer for presentations, following WCAG guidelines. An automatic check found the problems listed for each slide below. " +
			"For each slide: 1) for every image id listed, write a short alternative text (at most 125 characters) describing the role of the image in the slide, based on the slide title and text; " +
			"2) if the problems include noTitle or duplicateTitle, suggest a short unique title; " +
			"3) if the problems include tooMuchText or smallFont, give one concrete piece of advice (at most 40 words) to fix it. " +
			"Write in the same language as the slide text. " +
			"Reply only with JSON in this exact format: {\"slides\": [{\"slide\": 1, \"altTexts\": [{\"image\": 0, \"altText\": \"...\"}], \"titleSuggestion\": \"...\", \"advice\": \"...\"}]}\n\n" +
			blocks;
	}

	// ---------------------------------------------------------------------
	// Tool entry point
	// ---------------------------------------------------------------------

	func.call = async function(params) {
		let useAI = params.useAI !== false;
		Asc.scope.slideNum = params.slideNumber;

		let collected = await Asc.Editor.callCommand(function(){
			let presentation = Api.GetPresentation();
			let count = presentation.GetSlidesCount();
			let from = 0, to = count - 1;
			if (Asc.scope.slideNum) {
				if (Asc.scope.slideNum < 1 || Asc.scope.slideNum > count)
					return { error: "slide_not_found", slidesCount: count };
				from = to = Asc.scope.slideNum - 1;
			}

			let slides = [];
			for (let idx = from; idx <= to; idx++) {
				let slide = presentation.GetSlideByIndex(idx);
				if (!slide)
					continue;

				let info = { index: idx + 1, title: "", texts: [], paragraphs: 0, words: 0, minFont: null, images: [] };
				let drawings = slide.GetAllDrawings();

				for (let i = 0; i < drawings.length; i++) {
					let drawing = drawings[i];
					let type = drawing.GetClassType();
					let ph = drawing.GetPlaceholder ? drawing.GetPlaceholder() : null;
					let phType = ph ? ph.GetType() : "";

					if (type === "shape") {
						let content = drawing.GetDocContent();
						if (!content)
							continue;
						let pars = content.GetAllParagraphs();
						for (let p = 0; p < pars.length; p++) {
							let t = pars[p].GetText().trim();
							if (!t)
								continue;

							if (phType === "title" || phType === "ctrTitle") {
								info.title += (info.title ? " " : "") + t;
							} else if (phType !== "sldNum" && phType !== "sldNumber" && phType !== "dt" && phType !== "date" && phType !== "ftr" && phType !== "footer") {
								info.texts.push(t);
								info.paragraphs++;
								info.words += t.split(/\s+/).length;
							}

							for (let r = 0; r < pars[p].GetElementsCount(); r++) {
								let run = pars[p].GetElement(r);
								if (!run || !run.GetClassType || run.GetClassType() !== "run")
									continue;
								if (!run.GetText().trim())
									continue;
								let size = run.GetTextPr().GetFontSize();
								if (size) {
									let pt = size / 2;
									if (info.minFont === null || pt < info.minFont)
										info.minFont = pt;
								}
							}
						}
					} else if (type === "image" || type === "chart" || type === "oleObject") {
						let alt = "";
						if (drawing.GetDescription)
							alt = drawing.GetDescription() || "";
						if (!alt && drawing.GetTitle)
							alt = drawing.GetTitle() || "";
						info.images.push({
							drawing: i,
							kind: type === "oleObject" ? "object" : type,
							name: drawing.GetName ? drawing.GetName() : "",
							alt: alt
						});
					}
				}
				slides.push(info);
			}
			return { slides: slides };
		});

		if (collected && collected.error === "slide_not_found")
			throw new window.AgentState.ToolError("Slide " + params.slideNumber + " does not exist! The presentation has " + collected.slidesCount + " slides.");
		if (!collected || !collected.slides || !collected.slides.length)
			throw new window.AgentState.ToolError("The presentation has no slides to check.");

		let slidesById = {};
		for (let s of collected.slides)
			slidesById[s.index] = s;

		let withIssues = findIssues(collected.slides);
		if (!withIssues.length)
			return { slidesChecked: collected.slides.length, slidesWithIssues: 0, message: "No accessibility problems were found." };

		let requestEngine = useAI ? AI.Request.create(AI.ActionType.Chat) : null;
		let modelName = requestEngine && requestEngine.modelUI ? requestEngine.modelUI.name : "Accessibility Checker";
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

		let suggestions = {};
		if (requestEngine) {
			try {
				let answer = await requestEngine.chatRequest(buildPrompt(withIssues, slidesById), false);
				let parsed = parseJsonFromModel(answer);
				if (parsed && Array.isArray(parsed.slides)) {
					for (let s of parsed.slides) {
						if (s && typeof s.slide === "number")
							suggestions[s.slide] = s;
					}
				}
			} catch (e) {
				// If the model fails, keep the automatic messages
			}
		}

		await checkEndAction();

		let comments = [];
		let altTextsToApply = [];
		for (let entry of withIssues) {
			let sug = suggestions[entry.slide] || {};
			let altById = {};
			if (Array.isArray(sug.altTexts)) {
				for (let a of sug.altTexts) {
					if (a && typeof a.altText === "string" && a.altText.trim())
						altById[a.image] = a.altText.trim().substring(0, 250);
				}
			}

			let lines = [];
			for (let issue of entry.issues) {
				let line = "• " + issue.detail;
				if (issue.kind === "missingAlt" && altById[issue.image]) {
					line += params.applyAltText ? " Alt text added: \"" + altById[issue.image] + "\" (check that it matches the image)." : " Suggested alt text: \"" + altById[issue.image] + "\"";
					if (params.applyAltText)
						altTextsToApply.push({ slide: entry.slide, drawing: issue.image, altText: altById[issue.image] });
				}
				if ((issue.kind === "noTitle" || issue.kind === "duplicateTitle") && typeof sug.titleSuggestion === "string" && sug.titleSuggestion.trim())
					line += " Suggested title: \"" + sug.titleSuggestion.trim() + "\"";
				lines.push(line);
			}
			if (typeof sug.advice === "string" && sug.advice.trim())
				lines.push("• Tip: " + sug.advice.trim());

			comments.push({ slide: entry.slide, message: COMMENT_PREFIX + "\n" + lines.join("\n") });
		}

		Asc.scope.comments = comments;
		Asc.scope.altTexts = altTextsToApply;
		Asc.scope.author = modelName;

		let applied = await Asc.Editor.callCommand(function(){
			let presentation = Api.GetPresentation();
			let commentsAdded = 0;
			let altApplied = 0;

			for (let a of Asc.scope.altTexts) {
				let slide = presentation.GetSlideByIndex(a.slide - 1);
				if (!slide)
					continue;
				let drawing = slide.GetAllDrawings()[a.drawing];
				if (drawing && drawing.SetDescription && drawing.SetDescription(a.altText))
					altApplied++;
			}

			for (let c of Asc.scope.comments) {
				let slide = presentation.GetSlideByIndex(c.slide - 1);
				if (slide && slide.AddComment(0, 0, c.message, Asc.scope.author, "uid" + Asc.scope.author))
					commentsAdded++;
			}
			return { commentsAdded: commentsAdded, altApplied: altApplied };
		});

		await Asc.Editor.callMethod("EndAction", ["GroupActions"]);

		let counts = {};
		for (let entry of withIssues)
			for (let issue of entry.issues)
				counts[issue.kind] = (counts[issue.kind] || 0) + 1;

		return {
			slidesChecked: collected.slides.length,
			slidesWithIssues: withIssues.length,
			missingAltText: counts.missingAlt || 0,
			slidesWithoutTitle: counts.noTitle || 0,
			duplicateTitles: counts.duplicateTitle || 0,
			slidesWithSmallText: counts.smallFont || 0,
			slidesWithTooMuchText: counts.tooMuchText || 0,
			altTextApplied: applied ? applied.altApplied : 0,
			commentsAdded: applied ? applied.commentsAdded : 0
		};
	};

	return func;
})();
