/**
 * QuestionBank.gs — CRUD helpers for the QuestionBank sheet, and one-time
 * seeding from the Term 1 Maths + English papers (parsed into seed/questions.json,
 * embedded below since Apps Script cannot read local repo files at runtime).
 */

var SEED_QUESTIONS = [
  {
    "id": "MATH-01",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "place value (Indian system)",
    "difficulty": 1,
    "question_text": "Write the number name of 4,08,25,610 in the Indian place value system.",
    "marks": 1,
    "answer_text": "Four crore eight lakh twenty-five thousand six hundred ten",
    "marking_notes": "All-or-nothing 1 mark; exact wording of place-value terms expected."
  },
  {
    "id": "MATH-02",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "Roman numerals",
    "difficulty": 1,
    "question_text": "Write 19 in Roman numerals.",
    "marks": 1,
    "answer_text": "XIX",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-03",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "comparing negative numbers",
    "difficulty": 1,
    "question_text": "Which is greater: \u22127 or \u22123?",
    "marks": 1,
    "answer_text": "\u22123",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-04",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "rounding",
    "difficulty": 1,
    "question_text": "Round 46,382 off to the nearest thousand.",
    "marks": 1,
    "answer_text": "46,000",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-05",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "time conversion",
    "difficulty": 1,
    "question_text": "3 hours = ________ minutes",
    "marks": 1,
    "answer_text": "180 minutes",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-06",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "12/24-hour clock",
    "difficulty": 1,
    "question_text": "Write 15:40 in the 12-hour clock.",
    "marks": 1,
    "answer_text": "3:40 p.m.",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-07",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "triangle types",
    "difficulty": 1,
    "question_text": "A triangle with all three sides equal is called a/an ____________ triangle.",
    "marks": 1,
    "answer_text": "Equilateral",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-08",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "angle types",
    "difficulty": 1,
    "question_text": "An angle measuring 112\u00b0 is a/an ____________ angle.",
    "marks": 1,
    "answer_text": "Obtuse",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-09",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "negative numbers",
    "difficulty": 1,
    "question_text": "\u22126 + 10 = ________",
    "marks": 1,
    "answer_text": "4",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-10",
    "subject": "Mathematics",
    "strand": "Mental Maths",
    "sub_skill": "3D shapes",
    "difficulty": 1,
    "question_text": "How many faces does a cube have?",
    "marks": 1,
    "answer_text": "6",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "MATH-11",
    "subject": "Mathematics",
    "strand": "Large Numbers",
    "sub_skill": "expanded form (Indian system)",
    "difficulty": 2,
    "question_text": "Write 7,50,63,208 in expanded form (Indian system).",
    "marks": 2,
    "answer_text": "7,00,00,000 + 50,00,000 + 60,000 + 3,000 + 200 + 8",
    "marking_notes": "1 mark if two or fewer place values are missing or misplaced."
  },
  {
    "id": "MATH-12",
    "subject": "Mathematics",
    "strand": "Large Numbers",
    "sub_skill": "number names (International system)",
    "difficulty": 2,
    "question_text": "Write the number name of 128,470,059 in the International place value system.",
    "marks": 2,
    "answer_text": "One hundred twenty-eight million, four hundred seventy thousand, fifty-nine",
    "marking_notes": "2 marks for fully correct; deduct for missing/incorrect terms."
  },
  {
    "id": "MATH-13",
    "subject": "Mathematics",
    "strand": "Large Numbers",
    "sub_skill": "ordering large numbers",
    "difficulty": 2,
    "question_text": "Arrange the following in descending order: 3,45,67,890 | 3,45,76,890 | 34,56,789 | 3,04,56,789",
    "marks": 2,
    "answer_text": "3,45,76,890 > 3,45,67,890 > 3,04,56,789 > 34,56,789",
    "marking_notes": "1 mark if only one pair is out of order."
  },
  {
    "id": "MATH-14",
    "subject": "Mathematics",
    "strand": "Large Numbers",
    "sub_skill": "Roman/Hindu-Arabic numerals",
    "difficulty": 1,
    "question_text": "(a) Write XVII in Hindu-Arabic numerals. (b) Write 14 in Roman numerals.",
    "marks": 2,
    "answer_text": "(a) 17  (b) XIV",
    "marking_notes": "1 mark each part."
  },
  {
    "id": "MATH-15",
    "subject": "Mathematics",
    "strand": "Large Numbers",
    "sub_skill": "rounding and estimation",
    "difficulty": 2,
    "question_text": "Round each number off to the nearest thousand and then find the estimated sum: 38,472 + 25,619",
    "marks": 2,
    "answer_text": "38,472 \u2192 38,000; 25,619 \u2192 26,000; estimated sum = 64,000",
    "marking_notes": "1 mark for correct rounding, 1 mark for the sum."
  },
  {
    "id": "MATH-16",
    "subject": "Mathematics",
    "strand": "Addition, Subtraction & Integers",
    "sub_skill": "addition of large numbers",
    "difficulty": 2,
    "question_text": "Add: 4,56,78,912 + 2,38,45,097",
    "marks": 2,
    "answer_text": "6,95,24,009",
    "marking_notes": "Full marks for correct answer; 1 mark for correct method with a minor arithmetic slip."
  },
  {
    "id": "MATH-17",
    "subject": "Mathematics",
    "strand": "Addition, Subtraction & Integers",
    "sub_skill": "subtraction of large numbers",
    "difficulty": 2,
    "question_text": "Subtract: 8,04,32,150 \u2212 3,67,85,296",
    "marks": 2,
    "answer_text": "4,36,46,854",
    "marking_notes": "Full marks for correct answer; 1 mark for correct method with a minor arithmetic slip."
  },
  {
    "id": "MATH-18",
    "subject": "Mathematics",
    "strand": "Addition, Subtraction & Integers",
    "sub_skill": "lattice method",
    "difficulty": 2,
    "question_text": "Use the lattice method to add 4,382 + 2,759. Draw the lattice grid clearly and show the diagonal carries.",
    "marks": 3,
    "answer_text": "7,141",
    "marking_notes": "1 mark for the grid, 1 mark for correct column sums, 1 mark for correctly read diagonal totals."
  },
  {
    "id": "MATH-19",
    "subject": "Mathematics",
    "strand": "Addition, Subtraction & Integers",
    "sub_skill": "integers",
    "difficulty": 2,
    "question_text": "Integers: (a) Put > or < in the box: \u221212 \u25a1 \u221220 (b) \u221215 + 8 = ________ (c) \u22129 \u2212 5 = ________",
    "marks": 3,
    "answer_text": "(a) \u221212 > \u221220  (b) \u22127  (c) \u221214",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "MATH-20",
    "subject": "Mathematics",
    "strand": "Addition, Subtraction & Integers",
    "sub_skill": "multi-step word problem",
    "difficulty": 3,
    "question_text": "In the year 2024, a district had a population of 2,45,67,830. During the next year, 3,42,175 people moved into the district and 1,87,940 people moved away. What was the population of the district at the end of the year?",
    "marks": 3,
    "answer_text": "2,45,67,830 + 3,42,175 = 2,49,10,005; 2,49,10,005 \u2212 1,87,940 = 2,47,22,065 people",
    "marking_notes": "1 mark addition, 1 mark subtraction, 1 mark correct statement of answer with units."
  },
  {
    "id": "MATH-21",
    "subject": "Mathematics",
    "strand": "Time & Money",
    "sub_skill": "time unit conversion",
    "difficulty": 2,
    "question_text": "Convert: (a) 5 days = ________ hours (b) 240 seconds = ________ minutes (c) 2 weeks 3 days = ________ days",
    "marks": 3,
    "answer_text": "(a) 120 hours  (b) 4 minutes  (c) 17 days",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "MATH-22",
    "subject": "Mathematics",
    "strand": "Time & Money",
    "sub_skill": "12/24-hour clock",
    "difficulty": 2,
    "question_text": "(a) Write 8:45 p.m. in the 24-hour clock. (b) Write 06:20 in the 12-hour clock.",
    "marks": 2,
    "answer_text": "(a) 20:45  (b) 6:20 a.m.",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "MATH-23",
    "subject": "Mathematics",
    "strand": "Time & Money",
    "sub_skill": "addition of time",
    "difficulty": 2,
    "question_text": "Add: 3 hours 45 minutes + 2 hours 40 minutes",
    "marks": 2,
    "answer_text": "6 hours 25 minutes",
    "marking_notes": "Working: 45 + 40 = 85 min = 1 h 25 min; 3 + 2 + 1 = 6 h. Award 1 mark for correct method if final answer has a minor slip."
  },
  {
    "id": "MATH-24",
    "subject": "Mathematics",
    "strand": "Time & Money",
    "sub_skill": "elapsed time",
    "difficulty": 2,
    "question_text": "A film began at 14:35 and ended at 16:20. For how long did the film run?",
    "marks": 2,
    "answer_text": "1 hour 45 minutes",
    "marking_notes": "Full marks for correct answer; part marks for correct method with a minor slip."
  },
  {
    "id": "MATH-25",
    "subject": "Mathematics",
    "strand": "Time & Money",
    "sub_skill": "money word problem",
    "difficulty": 3,
    "question_text": "Hamza's mother bought a book for \u20b9345.50, a pen set for \u20b9128.75 and a school bag for \u20b9899.00. She paid the shopkeeper with a \u20b92,000 note. How much change did she receive?",
    "marks": 3,
    "answer_text": "345.50 + 128.75 + 899.00 = \u20b91,373.25; 2,000.00 \u2212 1,373.25 = \u20b9626.75",
    "marking_notes": "2 marks for the correct total, 1 mark for the change. Deduct \u00bd mark if the \u20b9 symbol or decimal places are missing."
  },
  {
    "id": "MATH-26",
    "subject": "Mathematics",
    "strand": "Shape & Space",
    "sub_skill": "types of lines",
    "difficulty": 2,
    "question_text": "Name the type of lines described below: (a) Two lines in the same plane that never meet, however far they are extended. (b) Two lines that cross each other at an angle of exactly 90\u00b0. (c) Two lines that cross each other at a point but not at 90\u00b0.",
    "marks": 3,
    "answer_text": "(a) Parallel lines  (b) Perpendicular lines  (c) Intersecting lines",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "MATH-27",
    "subject": "Mathematics",
    "strand": "Shape & Space",
    "sub_skill": "classifying angles",
    "difficulty": 2,
    "question_text": "Classify each angle as acute, right, obtuse, straight or reflex: 45\u00b0 | 92\u00b0 | 180\u00b0 | 300\u00b0",
    "marks": 2,
    "answer_text": "45\u00b0 \u2014 acute; 92\u00b0 \u2014 obtuse; 180\u00b0 \u2014 straight; 300\u00b0 \u2014 reflex",
    "marking_notes": "\u00bd mark each (2 total)."
  },
  {
    "id": "MATH-28",
    "subject": "Mathematics",
    "strand": "Shape & Space",
    "sub_skill": "drawing angles",
    "difficulty": 2,
    "question_text": "Using a protractor, draw an angle of 65\u00b0 and label it \u2220ABC.",
    "marks": 2,
    "answer_text": "Angle drawn accurately to 65\u00b0 (\u00b1 2\u00b0), arms ruled straight, vertex labelled B",
    "marking_notes": "1 mark for accuracy, 1 mark for correct labelling of \u2220ABC. Requires visual inspection of the photographed drawing."
  },
  {
    "id": "MATH-29",
    "subject": "Mathematics",
    "strand": "Shape & Space",
    "sub_skill": "classifying triangles",
    "difficulty": 2,
    "question_text": "A triangle has angles measuring 90\u00b0, 45\u00b0 and 45\u00b0. (a) Name the triangle according to its angles. (b) Name the triangle according to its sides.",
    "marks": 2,
    "answer_text": "(a) Right-angled triangle  (b) Isosceles triangle",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "MATH-30",
    "subject": "Mathematics",
    "strand": "Shape & Space",
    "sub_skill": "3D shapes and nets",
    "difficulty": 2,
    "question_text": "(a) A net is made of 6 identical squares joined edge to edge. Which 3D shape will it fold into? (b) How many faces, edges and vertices does a square pyramid have?",
    "marks": 2,
    "answer_text": "(a) A cube  (b) 5 faces, 8 edges, 5 vertices",
    "marking_notes": "1 mark for (a). For (b), award the mark only if all three figures are correct."
  },
  {
    "id": "MATH-31",
    "subject": "Mathematics",
    "strand": "Shape & Space",
    "sub_skill": "symmetry",
    "difficulty": 2,
    "question_text": "Which of these capital letters have a vertical line of symmetry? A  F  M  P  H  R",
    "marks": 2,
    "answer_text": "A, M, H",
    "marking_notes": "\u00bd mark each for the three correct; deduct \u00bd for each wrong letter included."
  },
  {
    "id": "MATH-32",
    "subject": "Mathematics",
    "strand": "Shape & Space",
    "sub_skill": "reflection and rotation",
    "difficulty": 2,
    "question_text": "(a) The letter b is reflected in a vertical mirror line. Which letter does the image look like? (b) The letter b is rotated through 180\u00b0 about its centre. Which letter does the image look like?",
    "marks": 2,
    "answer_text": "(a) d  (b) q",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "ENG-01",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "literal recall",
    "difficulty": 1,
    "question_text": "Why had Aarav not been outside for eleven days?",
    "marks": 1,
    "answer_text": "It had been raining heavily for eleven days, so he was not allowed to go outside.",
    "marking_notes": "Accept close paraphrase covering both the rain and the reason he was kept in."
  },
  {
    "id": "ENG-02",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "literal recall",
    "difficulty": 1,
    "question_text": "What made Aarav stop the moment he pushed open the terrace door?",
    "marks": 1,
    "answer_text": "He saw that the terrace had been turned into a garden \u2014 rows of old paint buckets full of soil with plants growing in them.",
    "marking_notes": "Accept close paraphrase."
  },
  {
    "id": "ENG-03",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "textual evidence",
    "difficulty": 2,
    "question_text": "\"Someone had been using it after all.\" Give two pieces of evidence from the passage that show a person had been on the terrace recently.",
    "marks": 2,
    "answer_text": "Any two of: a pair of rubber slippers placed neatly by the door; an open notebook with a fresh entry dated 14 July; the rainwater pipe and the tank that was almost full; the tomato plants tied to sticks.",
    "marking_notes": "1 mark per valid piece of evidence, up to 2."
  },
  {
    "id": "ENG-04",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "inference",
    "difficulty": 2,
    "question_text": "What does the line \"The sky did the work\" tell you about the way the plants on the terrace are watered?",
    "marks": 2,
    "answer_text": "The gardener has bent a pipe to collect rainwater from the roof into a tank, so the rain waters the plants for him \u2014 he does not need to water them by hand during the monsoon.",
    "marking_notes": "1 mark for identifying rainwater collection, 1 mark for explaining the effect."
  },
  {
    "id": "ENG-05",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "vocabulary",
    "difficulty": 1,
    "question_text": "Find a word in the passage that means \"a young tree\".",
    "marks": 1,
    "answer_text": "Sapling",
    "marking_notes": "All-or-nothing 1 mark."
  },
  {
    "id": "ENG-06",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "character inference",
    "difficulty": 2,
    "question_text": "What kind of person do you think the gardener is? Give one reason from the passage to support your answer.",
    "marks": 2,
    "answer_text": "Any reasonable character trait with textual support, e.g. careful/organised (keeps a dated notebook, leaves slippers neatly by the door); resourceful (grows plants in old paint buckets and a cracked drum, bends a pipe to harvest rain); friendly, with a sense of humour (replies \"The lemon tree bites\").",
    "marking_notes": "1 mark for a valid trait, 1 mark for supporting evidence from the text."
  },
  {
    "id": "ENG-07",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "inference",
    "difficulty": 2,
    "question_text": "At the beginning of the passage the grey sky made Aarav miserable. Why do you think he grinned at the same grey sky at the end?",
    "marks": 2,
    "answer_text": "Accept any well-reasoned inference: the rain is no longer only something that traps him indoors \u2014 it is now useful, because it waters the garden; and he has found something to look forward to and someone to befriend, so he is no longer lonely.",
    "marking_notes": "Award full marks for any inference well supported by the passage."
  },
  {
    "id": "ENG-08",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "summary writing",
    "difficulty": 3,
    "question_text": "Summarise the passage in three or four sentences.",
    "marks": 3,
    "answer_text": "Summary should cover: Aarav is lonely and stuck indoors in a new flat during the monsoon \u2192 his grandmother tells him about the unused terrace \u2192 he discovers a hidden garden grown in old buckets, watered by collected rainwater \u2192 he leaves a note offering to help and receives a friendly reply.",
    "marking_notes": "3 = all four points, own words, 3-4 sentences. 2 = most points or copied phrasing. 1 = one or two points only."
  },
  {
    "id": "ENG-09",
    "subject": "English",
    "strand": "Reading Comprehension",
    "sub_skill": "title/theme",
    "difficulty": 2,
    "question_text": "Suggest a different title for the passage and give a reason for your choice.",
    "marks": 1,
    "answer_text": "Any suitable title (e.g. The Secret Gardener, A Note Under a Stone, The Sky Did the Work) with a reason linked to the passage.",
    "marking_notes": "Award the mark only if the title is paired with a relevant reason."
  },
  {
    "id": "ENG-10",
    "subject": "English",
    "strand": "Grammar & Spelling",
    "sub_skill": "punctuation & capitalisation",
    "difficulty": 2,
    "question_text": "Rewrite the following sentences using correct punctuation and capital letters: (a) wow shouted meera look at the size of that kite (b) my fathers office is in bandra isnt it far from here (c) we packed apples bananas and grapes for the trip",
    "marks": 3,
    "answer_text": "(a) \"Wow!\" shouted Meera. \"Look at the size of that kite!\" (b) My father's office is in Bandra. Isn't it far from here? (c) We packed apples, bananas and grapes for the trip.",
    "marking_notes": "1 mark per sentence for fully correct punctuation and capitalisation."
  },
  {
    "id": "ENG-11",
    "subject": "English",
    "strand": "Grammar & Spelling",
    "sub_skill": "parts of speech",
    "difficulty": 1,
    "question_text": "Write the part of speech of the word in bold in each sentence: (a) The old bridge shook in the storm. (b) She quickly shut the window. (c) Ouch! I stepped on a pin. (d) Rohan and Zoya went to the market, but they returned empty-handed.",
    "marks": 4,
    "answer_text": "(a) Adjective  (b) Adverb  (c) Interjection  (d) Conjunction",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "ENG-12",
    "subject": "English",
    "strand": "Grammar & Spelling",
    "sub_skill": "negative sentences",
    "difficulty": 2,
    "question_text": "Change the following into negative sentences without changing the meaning: (a) Ravi always tells the truth. (b) All the mangoes were ripe. (c) The test was easy.",
    "marks": 3,
    "answer_text": "(a) Ravi never tells a lie. (b) None of the mangoes was unripe. (Accept: Not one of the mangoes was unripe.) (c) The test was not difficult.",
    "marking_notes": "1 mark per part; accept valid equivalent phrasing that preserves the original meaning."
  },
  {
    "id": "ENG-13",
    "subject": "English",
    "strand": "Grammar & Spelling",
    "sub_skill": "degrees of comparison",
    "difficulty": 2,
    "question_text": "Fill in the blanks with the correct degree of comparison: (a) This is the ____________ (tall) building in the city. (b) My school bag is ____________ (heavy) than yours. (c) The winter in Mumbai is ____________ (mild) than the winter in Delhi. (d) Rewrite in the comparative degree: No other river in India is as long as the Ganga.",
    "marks": 4,
    "answer_text": "(a) tallest  (b) heavier  (c) milder  (d) The Ganga is longer than any other river in India.",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "ENG-14",
    "subject": "English",
    "strand": "Grammar & Spelling",
    "sub_skill": "interjections",
    "difficulty": 1,
    "question_text": "Fill in each blank with a suitable interjection: (a) ____________! Our team has won the match. (b) ____________! The vase has broken into pieces.",
    "marks": 2,
    "answer_text": "(a) Hurrah! (Accept: Hooray!)  (b) Alas! (Accept: Oh no!)",
    "marking_notes": "1 mark per part; accept any suitable interjection matching the sentiment."
  },
  {
    "id": "ENG-15",
    "subject": "English",
    "strand": "Grammar & Spelling",
    "sub_skill": "relative pronouns",
    "difficulty": 2,
    "question_text": "Fill in the blanks with the correct relative pronoun (who, whom, whose, which, that): (a) This is the boy ____________ won the hundred-metre race. (b) The book ____________ I borrowed from the library is torn. (c) I met a girl ____________ brother plays for the state team.",
    "marks": 3,
    "answer_text": "(a) who  (b) which (accept: that)  (c) whose",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "ENG-16",
    "subject": "English",
    "strand": "Grammar & Spelling",
    "sub_skill": "adverbs",
    "difficulty": 2,
    "question_text": "Write the adverb in each sentence and state its type (manner, time, place, frequency or degree): (a) She sings beautifully. (b) We will leave tomorrow. (c) He rarely complains.",
    "marks": 3,
    "answer_text": "(a) beautifully \u2014 adverb of manner (b) tomorrow \u2014 adverb of time (c) rarely \u2014 adverb of frequency",
    "marking_notes": "1 mark per part; \u00bd for the correct adverb, \u00bd for the correct type."
  },
  {
    "id": "ENG-17",
    "subject": "English",
    "strand": "Grammar & Spelling",
    "sub_skill": "spelling",
    "difficulty": 1,
    "question_text": "Each sentence has one misspelt word. Write the word correctly: (a) The knowlege he gained was very useful. (b) We recieved a letter from our cousin. (c) It was a beautifull morning in the hills.",
    "marks": 3,
    "answer_text": "(a) knowledge  (b) received  (c) beautiful",
    "marking_notes": "1 mark per part."
  },
  {
    "id": "ENG-18",
    "subject": "English",
    "strand": "Letter Writing",
    "sub_skill": "informal/formal letter",
    "difficulty": 3,
    "question_text": "Attempt any ONE of the following letters in about 100-120 words: (a) Informal letter \u2014 Write a letter to your cousin describing a weekend you recently spent with your family. Mention where you went, what you did and what you enjoyed most. OR (b) Formal letter \u2014 Write a letter to your Principal requesting permission to start a terrace garden in school. Explain why you think it is a good idea and how the students will look after it.",
    "marks": 10,
    "answer_text": "Rubric-based \u2014 no single correct answer; grade per the marking notes.",
    "marking_notes": "Correct format for the type chosen (3): informal needs address, date, salutation \"Dear ___\", body, closing \"Love/Yours affectionately\", name; formal needs sender's address, date, receiver's designation and address, \"Dear Sir/Madam\", subject line, body, \"Yours sincerely/faithfully\". Content \u2014 all prompt points covered, relevant and developed (3). Tone appropriate to the reader (2). Grammar, punctuation, spelling and word limit (2)."
  },
  {
    "id": "ENG-19",
    "subject": "English",
    "strand": "Descriptive Writing",
    "sub_skill": "descriptive paragraph",
    "difficulty": 3,
    "question_text": "Write a descriptive paragraph in about 100-120 words on any ONE of the following: (a) A Rainy Evening in My City (b) The Market on a Sunday Morning. In your paragraph, use at least three adverbs and two adjectives in the comparative or superlative degree. Underline them.",
    "marks": 10,
    "answer_text": "Rubric-based \u2014 no single correct answer; grade per the marking notes.",
    "marking_notes": "Ideas and content \u2014 clear picture of the scene, stays on topic (3). Sensory detail and vivid vocabulary (2). Correct use and underlining of at least 3 adverbs and 2 comparative/superlative adjectives (2). Paragraph structure \u2014 opening, developed middle, closing (1). Grammar, punctuation, spelling and word limit (2)."
  }
];

/**
 * Populates QuestionBank from SEED_QUESTIONS. Skips ids that already exist so
 * this is safe to re-run. Logs a per-subject/strand count summary when done.
 */
function seedQuestionBank() {
  ensureSheets_();
  var sheet = getSheet_(SHEET_QUESTIONBANK);
  var existingIds = readSheetAsObjects_(SHEET_QUESTIONBANK).map(function (q) { return q.id; });

  var rows = SEED_QUESTIONS
    .filter(function (q) { return existingIds.indexOf(q.id) === -1; })
    .map(function (q) {
      return [q.id, q.subject, q.strand, q.sub_skill, q.difficulty, q.question_text,
        q.marks, q.answer_text, q.marking_notes, '', 0];
    });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SHEET_HEADERS[SHEET_QUESTIONBANK].length).setValues(rows);
  }

  logQuestionBankSummary_();
  return { inserted: rows.length, skipped: SEED_QUESTIONS.length - rows.length };
}

/** Prints a per-subject/strand question + marks count so seeding can be verified. */
function logQuestionBankSummary_() {
  var all = readSheetAsObjects_(SHEET_QUESTIONBANK);
  var counts = {};
  all.forEach(function (q) {
    var key = q.subject + ' \u2014 ' + q.strand;
    if (!counts[key]) counts[key] = { questions: 0, marks: 0 };
    counts[key].questions += 1;
    counts[key].marks += Number(q.marks) || 0;
  });
  Logger.log('QuestionBank summary (%s total rows):', all.length);
  Object.keys(counts).sort().forEach(function (key) {
    Logger.log('  %s: %s questions, %s marks', key, counts[key].questions, counts[key].marks);
  });
}

function getAllQuestions_() {
  return readSheetAsObjects_(SHEET_QUESTIONBANK);
}

function getQuestionsBySubject_(subject) {
  return getAllQuestions_().filter(function (q) { return q.subject === subject; });
}

function getQuestionsByIds_(ids) {
  var idSet = {};
  ids.forEach(function (id) { idSet[id] = true; });
  return getAllQuestions_().filter(function (q) { return idSet[q.id]; });
}

/** Bumps times_used and last_used_date for every question id used in a freshly generated paper. */
function markQuestionsUsed_(ids) {
  var sheet = getSheet_(SHEET_QUESTIONBANK);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var headers = SHEET_HEADERS[SHEET_QUESTIONBANK];
  var idCol = headers.indexOf('id') + 1;
  var lastUsedCol = headers.indexOf('last_used_date') + 1;
  var timesUsedCol = headers.indexOf('times_used') + 1;
  var idValues = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  var idSet = {};
  ids.forEach(function (id) { idSet[id] = true; });
  var today = todayString_();

  idValues.forEach(function (row, i) {
    if (idSet[row[0]]) {
      var sheetRow = i + 2;
      var current = sheet.getRange(sheetRow, timesUsedCol).getValue();
      sheet.getRange(sheetRow, timesUsedCol).setValue((Number(current) || 0) + 1);
      sheet.getRange(sheetRow, lastUsedCol).setValue(today);
    }
  });
}
