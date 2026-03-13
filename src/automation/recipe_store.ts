/**
 * RecipeStore
 *
 * Persistent JSON-backed storage for automation recipes and their run history.
 * Recipes are stored in data/recipes/recipes.json.
 * Run history is stored in data/recipes/runs.json.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Recipe, RecipeRun } from "../../schema/recipes.js";

const DEFAULT_STORAGE_DIR = path.resolve(process.cwd(), "data", "recipes");

export class RecipeStore {
  private recipesPath: string;
  private runsPath: string;

  constructor(storageDir: string = DEFAULT_STORAGE_DIR) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.recipesPath = path.join(storageDir, "recipes.json");
    this.runsPath = path.join(storageDir, "runs.json");
  }

  // ─── Recipes ────────────────────────────────────────────────────────────────

  private readRecipes(): Recipe[] {
    try {
      if (!fs.existsSync(this.recipesPath)) return [];
      return JSON.parse(fs.readFileSync(this.recipesPath, "utf8")) as Recipe[];
    } catch {
      return [];
    }
  }

  private writeRecipes(recipes: Recipe[]): void {
    fs.writeFileSync(this.recipesPath, JSON.stringify(recipes, null, 2));
  }

  /** Create a new recipe. */
  createRecipe(data: Omit<Recipe, "id" | "created_at" | "updated_at" | "run_count">): Recipe {
    const recipes = this.readRecipes();
    const now = new Date().toISOString();
    const recipe: Recipe = {
      ...data,
      id: `recipe-${crypto.randomUUID().slice(0, 8)}`,
      created_at: now,
      updated_at: now,
      run_count: 0,
    };
    recipes.push(recipe);
    this.writeRecipes(recipes);
    return recipe;
  }

  /** Update an existing recipe. */
  updateRecipe(id: string, updates: Partial<Omit<Recipe, "id" | "created_at">>): Recipe | null {
    const recipes = this.readRecipes();
    const idx = recipes.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    recipes[idx] = { ...recipes[idx], ...updates, updated_at: new Date().toISOString() };
    this.writeRecipes(recipes);
    return recipes[idx];
  }

  /** Get all recipes. */
  listRecipes(): Recipe[] {
    return this.readRecipes();
  }

  /** Get enabled recipes only. */
  listEnabledRecipes(): Recipe[] {
    return this.readRecipes().filter((r) => r.enabled);
  }

  /** Find a recipe by ID. */
  findRecipeById(id: string): Recipe | undefined {
    return this.readRecipes().find((r) => r.id === id);
  }

  /** Find recipes by trigger kind. */
  findRecipesByTrigger(triggerKind: string): Recipe[] {
    return this.readRecipes().filter(
      (r) => r.enabled && r.trigger.kind === triggerKind
    );
  }

  /** Increment the run count for a recipe. */
  incrementRunCount(id: string, lastRunAt: string): void {
    const recipes = this.readRecipes();
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe) return;
    recipe.run_count = (recipe.run_count ?? 0) + 1;
    recipe.last_run_at = lastRunAt;
    recipe.updated_at = lastRunAt;
    this.writeRecipes(recipes);
  }

  // ─── Runs ────────────────────────────────────────────────────────────────────

  private readRuns(): RecipeRun[] {
    try {
      if (!fs.existsSync(this.runsPath)) return [];
      return JSON.parse(fs.readFileSync(this.runsPath, "utf8")) as RecipeRun[];
    } catch {
      return [];
    }
  }

  private writeRuns(runs: RecipeRun[]): void {
    fs.writeFileSync(this.runsPath, JSON.stringify(runs, null, 2));
  }

  /** Create a new run record. */
  createRun(data: Omit<RecipeRun, "id" | "started_at">): RecipeRun {
    const runs = this.readRuns();
    const run: RecipeRun = {
      ...data,
      id: `run-${crypto.randomUUID().slice(0, 8)}`,
      started_at: new Date().toISOString(),
    };
    runs.push(run);
    this.writeRuns(runs);
    return run;
  }

  /** Update a run record. */
  updateRun(id: string, updates: Partial<Omit<RecipeRun, "id" | "started_at">>): RecipeRun | null {
    const runs = this.readRuns();
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    runs[idx] = { ...runs[idx], ...updates };
    this.writeRuns(runs);
    return runs[idx];
  }

  /** Get all runs. */
  listRuns(): RecipeRun[] {
    return this.readRuns();
  }

  /** Get runs for a specific recipe. */
  listRunsByRecipe(recipeId: string): RecipeRun[] {
    return this.readRuns().filter((r) => r.recipe_id === recipeId);
  }

  /** Find a run by ID. */
  findRunById(id: string): RecipeRun | undefined {
    return this.readRuns().find((r) => r.id === id);
  }
}
