---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me" or /grill-me.
---

# Grill Me

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

## Core Rules

1. **Work in Rounds (The Frontier):**
   - The **frontier** is every decision whose prerequisites are already settled: the questions you can ask *now* without guessing at answers you haven't heard yet.
   - Ask the whole frontier in one round: number each question and provide your recommended answer.
   - Wait for the user's answers before moving to the next round.
   - A question whose answer depends on another unsettled question belongs to a *later* round, not this one.

2. **Format of Each Round:**
   ```markdown
   ❓ **Q1** - **<question title>**: <question body, context, and choices if applicable>

   ➡️ **Recommendation**: <your recommended answer and rationale>

   ---

   ❓ **Q2** - **<question title>**: <question body, context, and choices if applicable>

   ➡️ **Recommendation**: <your recommended answer and rationale>
   ```

3. **Formulation:**
   - Word each question so "yes" or accepting the recommendation is straightforward.
   - When interactive choice selection is beneficial, use the `ask_question` tool with your recommended option placed first.

4. **Finding Facts vs. Decisions:**
   - Finding **facts** is your job, never the user's.
   - If a question can be answered by exploring the codebase, files, or environment, investigate it directly rather than asking the user.
   - The **decisions** (trade-offs, preferences, scope, constraints) belong to the user.

5. **Completion:**
   - The session is done when the frontier is empty: every branch of the design tree is visited, and nothing is left silently assumed.
   - Do not begin implementation until the user confirms you have reached shared understanding.
