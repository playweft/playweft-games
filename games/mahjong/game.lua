local RANDOM_MODULUS = 2147483647
local RANDOM_MULTIPLIER = 48271
local PLAYER_COUNT = 4
local RED_FIVES = { [17] = true, [53] = true, [89] = true }
local finish_exhaustive_draw
local finish_abortive_draw
local cancel_ippatsu

local function normalize_random_seed(value)
	local seed = 0
	local text = tostring(value or "")
	for index = 1, #text do
		local digit = tonumber(string.sub(text, index, index), 16)
		if digit then
			seed = (seed * 16 + digit) % RANDOM_MODULUS
		end
	end
	return seed == 0 and 1 or seed
end

local function rule_settings(settings)
	local supplied = settings and settings.rules or {}
	local function enabled(name, default)
		if supplied[name] == nil then
			return default
		end
		return supplied[name] == true
	end
	return {
		multipleRon = enabled("multipleRon", true),
		tripleRonAbort = enabled("tripleRonAbort", false),
		abortiveDraws = enabled("abortiveDraws", true),
		nagashiMangan = enabled("nagashiMangan", true),
		pao = enabled("pao", true),
		bankruptcy = enabled("bankruptcy", true),
		extensions = enabled("extensions", true),
		agariYame = enabled("agariYame", true),
	}
end

local function copy_array(source)
	local result = {}
	for _, value in ipairs(source or {}) do
		result[#result + 1] = value
	end
	return result
end

local function setup_players(context)
	local players, names = {}, {}
	for _, player in ipairs(context.players or {}) do
		players[#players + 1] = player.id
		names[#names + 1] = type(player.name) == "string" and player.name or ""
	end
	local ai_players = {}
	local ai_count = 0
	while #players < PLAYER_COUNT do
		local ai_id = "mahjong-ai-" .. tostring(#players + 1)
		ai_count = ai_count + 1
		players[#players + 1] = ai_id
		names[#names + 1] = "AI " .. tostring(ai_count)
		ai_players[ai_id] = true
	end
	return players, names, ai_players
end

-- Seat assignment is a match-level decision. Keep the lobby's join order for
-- display, then use this deterministic shuffle when the owner starts a room so
-- humans and AI have exactly the same chance of occupying every seat. Names
-- travel with player IDs; the returned order is fixed for the whole match.
function mahjong_shuffle_match_players(players, names, seed)
	local entries = {}
	for index, player_id in ipairs(players or {}) do
		entries[#entries + 1] = {
			id = player_id,
			name = names and names[index] or "",
		}
	end
	local shuffle_seed = normalize_random_seed(seed)
	for index = #entries, 2, -1 do
		shuffle_seed = (shuffle_seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
		local other = (shuffle_seed % index) + 1
		entries[index], entries[other] = entries[other], entries[index]
	end
	local shuffled_players, shuffled_names = {}, {}
	for index, entry in ipairs(entries) do
		shuffled_players[index] = entry.id
		shuffled_names[index] = entry.name
	end
	return shuffled_players, shuffled_names
end

local function player_index(state, player_id)
	for index, id in ipairs(state.players) do
		if id == player_id then
			return index
		end
	end
	return nil
end

local function rejected(reason)
	return { accepted = false, error = {
		code = string.upper(reason),
		message = string.gsub(reason, "_", " "),
	} }
end

local function accepted(state, events)
	return { accepted = true, state = state, events = events or {} }
end

local function tile_type(tile)
	return math.floor((tile - 1) / 4) + 1
end

local function tile_code(tile)
	local kind = tile_type(tile)
	if RED_FIVES[tile] then
		return ({ [5] = "0m", [14] = "0p", [23] = "0s" })[kind]
	end
	if kind <= 27 then
		local rank = ((kind - 1) % 9) + 1
		local suit = ({ "m", "p", "s" })[math.floor((kind - 1) / 9) + 1]
		return tostring(rank) .. suit
	end
	return tostring(kind - 27) .. "z"
end

local function copy_record_value(value)
	if type(value) ~= "table" then
		return value
	end
	local copy = {}
	for key, nested in pairs(value) do
		copy[key] = copy_record_value(nested)
	end
	return copy
end

local function copy_scores_for_record(scores)
	return { scores[1], scores[2], scores[3], scores[4] }
end

local function is_honor(kind)
	return kind >= 28
end
local function is_terminal(kind)
	if kind > 27 then
		return false
	end
	local rank = ((kind - 1) % 9) + 1
	return rank == 1 or rank == 9
end
local function is_outside(kind)
	return is_honor(kind) or is_terminal(kind)
end

local function sort_hand(hand)
	table.sort(hand, function(left, right)
		local a, b = tile_type(left), tile_type(right)
		return a == b and left < right or a < b
	end)
	return hand
end

local function next_random(state)
	state.seed = (state.seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
	return state.seed
end

local function next_match_seed(seed)
	local next = (math.floor(math.abs(tonumber(seed) or 1)) * RANDOM_MULTIPLIER + 1) % RANDOM_MODULUS
	return next == 0 and 1 or next
end

local function shuffled_tiles(state)
	local tiles = {}
	for tile = 1, 136 do
		tiles[tile] = tile
	end
	for index = #tiles, 2, -1 do
		local other = (next_random(state) % index) + 1
		tiles[index], tiles[other] = tiles[other], tiles[index]
	end
	return tiles
end

local function type_counts(tiles)
	local counts = {}
	for kind = 1, 34 do
		counts[kind] = 0
	end
	for _, tile in ipairs(tiles or {}) do
		local kind = tile_type(tile)
		counts[kind] = counts[kind] + 1
	end
	return counts
end

local function collect_sets(counts, needed, groups, results)
	if needed == 0 then
		for kind = 1, 34 do
			if counts[kind] ~= 0 then
				return
			end
		end
		local result = {}
		for _, group in ipairs(groups) do
			result[#result + 1] = group
		end
		results[#results + 1] = result
		return
	end
	local first
	for kind = 1, 34 do
		if counts[kind] > 0 then
			first = kind
			break
		end
	end
	if not first then
		return
	end
	if counts[first] >= 3 then
		counts[first] = counts[first] - 3
		groups[#groups + 1] = { kind = "triplet", tile = first, open = false }
		collect_sets(counts, needed - 1, groups, results)
		groups[#groups] = nil
		counts[first] = counts[first] + 3
	end
	local rank = ((first - 1) % 9) + 1
	if first <= 27 and rank <= 7 and counts[first + 1] > 0 and counts[first + 2] > 0 then
		counts[first], counts[first + 1], counts[first + 2] =
			counts[first] - 1, counts[first + 1] - 1, counts[first + 2] - 1
		groups[#groups + 1] = { kind = "sequence", tile = first, open = false }
		collect_sets(counts, needed - 1, groups, results)
		groups[#groups] = nil
		counts[first], counts[first + 1], counts[first + 2] =
			counts[first] + 1, counts[first + 1] + 1, counts[first + 2] + 1
	end
end

local function standard_decompositions(tiles, melds)
	local needed = 4 - #(melds or {})
	if #tiles ~= needed * 3 + 2 then
		return {}
	end
	local counts, results = type_counts(tiles), {}
	for pair = 1, 34 do
		if counts[pair] >= 2 then
			counts[pair] = counts[pair] - 2
			local sets = {}
			collect_sets(counts, needed, {}, sets)
			counts[pair] = counts[pair] + 2
			for _, groups in ipairs(sets) do
				results[#results + 1] = { pair = pair, groups = groups }
			end
		end
	end
	return results
end

local function is_seven_pairs(tiles, melds)
	if #(melds or {}) ~= 0 or #tiles ~= 14 then
		return false
	end
	local counts, pairs = type_counts(tiles), 0
	for kind = 1, 34 do
		if counts[kind] == 2 then
			pairs = pairs + 1
		elseif counts[kind] ~= 0 then
			return false
		end
	end
	return pairs == 7
end

local function is_thirteen_orphans(tiles, melds)
	if #(melds or {}) ~= 0 or #tiles ~= 14 then
		return false
	end
	local required = { 1, 9, 10, 18, 19, 27, 28, 29, 30, 31, 32, 33, 34 }
	local counts, pair_found = type_counts(tiles), false
	for _, kind in ipairs(required) do
		if counts[kind] == 0 then
			return false
		end
		if counts[kind] >= 2 then
			pair_found = true
		end
	end
	for kind = 1, 34 do
		if counts[kind] > 0 and not is_outside(kind) then
			return false
		end
	end
	return pair_found
end

-- This is intentionally separate from `standard_decompositions`: rule
-- validation often only needs to know whether a hand can win at all.  Building
-- every decomposition for a non-winning, sequence-heavy hand is needlessly
-- expensive in the authoritative room runtime.
local function has_standard_decomposition(tiles, melds)
	local needed = 4 - #(melds or {})
	if #tiles ~= needed * 3 + 2 then
		return false
	end
	local counts = type_counts(tiles)
	-- Groups never cross suit boundaries.  A standard hand has exactly one
	-- pair, so each suit (and the honors) must contain a multiple of three
	-- tiles, except for one component with two extra tiles.  This cheap,
	-- necessary test rejects the overwhelming majority of random claim checks
	-- before the full decomposition routine is needed.
	for kind = 28, 34 do
		-- Honors cannot form sequences, so a lone honor (or four concealed
		-- copies) can never belong to a completed standard hand.
		if counts[kind] == 1 or counts[kind] == 4 then
			return false
		end
	end
	local pair_components = 0
	for _, bounds in ipairs({ { 1, 9 }, { 10, 18 }, { 19, 27 }, { 28, 34 } }) do
		local total = 0
		for kind = bounds[1], bounds[2] do
			total = total + counts[kind]
		end
		local remainder = total % 3
		if remainder == 2 then
			pair_components = pair_components + 1
		elseif remainder ~= 0 then
			return false
		end
	end
	if pair_components ~= 1 then
		return false
	end
	return #standard_decompositions(tiles, melds) > 0
end

local function is_structural_win(tiles, melds)
	return is_seven_pairs(tiles, melds)
		or is_thirteen_orphans(tiles, melds)
		or has_standard_decomposition(tiles, melds)
end

local function is_closed_hand(melds)
	for _, meld in ipairs(melds or {}) do
		if meld.kind ~= "ankan" then
			return false
		end
	end
	return true
end

-- `waiting_types` is called by the authoritative room when an exhaustive
-- draw is settled.  Do not calculate it by constructing 34 candidate hands
-- and enumerating every decomposition: a single unlucky four-player draw can
-- otherwise exceed the room's instruction quota.
--
-- Instead, each of the three suits and honors returns a compact bit mask of
-- the complete groups and optional pair it can form.  The recursive cache is
-- keyed by a base-five count vector, so all candidate waits in a component
-- share one search. The masks are combined afterwards to check for the
-- required four groups and one pair.
local WAIT_SIGNATURE_BITS = { 1, 2, 4, 8, 16, 32, 64, 128, 256, 512 }

local function wait_signature_has(signature, groups, pair)
	local bit = WAIT_SIGNATURE_BITS[groups * 2 + pair + 1]
	return bit and math.floor(signature / bit) % 2 == 1
end

local function wait_signature_add_group(signature)
	local result = 0
	for groups = 0, 3 do
		for pair = 0, 1 do
			if wait_signature_has(signature, groups, pair) then
				result = result + WAIT_SIGNATURE_BITS[(groups + 1) * 2 + pair + 1]
			end
		end
	end
	return result
end

local function wait_signature_add_pair(signature)
	local result = 0
	for groups = 0, 4 do
		if wait_signature_has(signature, groups, 0) then
			result = result + WAIT_SIGNATURE_BITS[groups * 2 + 2]
		end
	end
	return result
end

local function wait_component_key(counts, first, last)
	local code, factor = 0, 1
	for kind = first, last do
		code, factor = code + counts[kind] * factor, factor * 5
	end
	return code
end

local function wait_component_signature(counts, first, last, sequences, cache)
	local code = wait_component_key(counts, first, last)
	if cache[code] ~= nil then
		return cache[code]
	end
	local kind = first
	while kind <= last and counts[kind] == 0 do
		kind = kind + 1
	end
	if kind > last then
		cache[code] = 1
		return 1
	end
	local branches = {}
	if counts[kind] >= 2 then
		counts[kind] = counts[kind] - 2
		branches[#branches + 1] = wait_signature_add_pair(
			wait_component_signature(counts, first, last, sequences, cache)
		)
		counts[kind] = counts[kind] + 2
	end
	if counts[kind] >= 3 then
		counts[kind] = counts[kind] - 3
		branches[#branches + 1] = wait_signature_add_group(
			wait_component_signature(counts, first, last, sequences, cache)
		)
		counts[kind] = counts[kind] + 3
	end
	if sequences and kind <= last - 2 and counts[kind + 1] > 0 and counts[kind + 2] > 0 then
		counts[kind], counts[kind + 1], counts[kind + 2] =
			counts[kind] - 1, counts[kind + 1] - 1, counts[kind + 2] - 1
		branches[#branches + 1] = wait_signature_add_group(
			wait_component_signature(counts, first, last, sequences, cache)
		)
		counts[kind], counts[kind + 1], counts[kind + 2] =
			counts[kind] + 1, counts[kind + 1] + 1, counts[kind + 2] + 1
	end
	-- The branches are bit sets, so they must be merged bitwise: adding them
	-- arithmetically carries whenever two decompositions of one component reach
	-- the same (groups, pair) state -- `6s6s6s7s8s` reads both as `678` plus a
	-- pair and as `666` plus a pair.  A carried mask invents an unreachable
	-- state while dropping the real one, which reports a legal wait as noten.
	local signature = 0
	for _, branch in ipairs(branches) do
		for index = 1, 10 do
			local bit = WAIT_SIGNATURE_BITS[index]
			if math.floor(branch / bit) % 2 == 1 and math.floor(signature / bit) % 2 == 0 then
				signature = signature + bit
			end
		end
	end
	cache[code] = signature
	return signature
end

local function wait_mask_has(mask, relative_kind)
	local bit = WAIT_SIGNATURE_BITS[relative_kind]
	return bit and math.floor(mask / bit) % 2 == 1
end

local function wait_mask_add(mask, bit)
	return math.floor(mask / bit) % 2 == 1 and mask or mask + bit
end

local function wait_mask_merge(left, right, length)
	for relative_kind = 1, length do
		local bit = WAIT_SIGNATURE_BITS[relative_kind]
		if math.floor(right / bit) % 2 == 1 then
			left = wait_mask_add(left, bit)
		end
	end
	return left
end

-- Return every way this component can be completed by exactly one extra tile.
-- Each entry is keyed by the resulting group/pair signature and contains a
-- bit mask of the local tile kinds that can be that extra tile.  Sharing this
-- search across all candidate tiles avoids the 34 separate recursive walks
-- performed by the old `waiting_types` implementation.
local function wait_added_component_signatures(counts, first, last, sequences, complete_cache, added_cache)
	local code = wait_component_key(counts, first, last)
	if added_cache[code] then
		return added_cache[code]
	end
	local length, kind, result = last - first + 1, first, {}
	while kind <= last and counts[kind] == 0 do
		kind = kind + 1
	end
	if kind > last then
		added_cache[code] = result
		return result
	end
	local function merge_added(source, group_delta, pair_delta)
		for index, mask in pairs(source) do
			local groups, pair = math.floor((index - 1) / 2), (index - 1) % 2
			if groups + group_delta <= 4 and pair + pair_delta <= 1 then
				local target = (groups + group_delta) * 2 + pair + pair_delta + 1
				result[target] = wait_mask_merge(result[target] or 0, mask, length)
			end
		end
	end
	local function add_candidate(signature, group_delta, pair_delta, relative_kind)
		local bit = WAIT_SIGNATURE_BITS[relative_kind]
		for groups = 0, 4 - group_delta do
			for pair = 0, 1 - pair_delta do
				if wait_signature_has(signature, groups, pair) then
					local target = (groups + group_delta) * 2 + pair + pair_delta + 1
					result[target] = wait_mask_add(result[target] or 0, bit)
				end
			end
		end
	end
	local relative_kind = kind - first + 1
	if counts[kind] >= 2 then
		counts[kind] = counts[kind] - 2
		merge_added(wait_added_component_signatures(counts, first, last, sequences, complete_cache, added_cache), 0, 1)
		counts[kind] = counts[kind] + 2
	end
	if counts[kind] >= 3 then
		counts[kind] = counts[kind] - 3
		merge_added(wait_added_component_signatures(counts, first, last, sequences, complete_cache, added_cache), 1, 0)
		counts[kind] = counts[kind] + 3
	end
	if sequences and kind <= last - 2 and counts[kind + 1] > 0 and counts[kind + 2] > 0 then
		counts[kind], counts[kind + 1], counts[kind + 2] =
			counts[kind] - 1, counts[kind + 1] - 1, counts[kind + 2] - 1
		merge_added(wait_added_component_signatures(counts, first, last, sequences, complete_cache, added_cache), 1, 0)
		counts[kind], counts[kind + 1], counts[kind + 2] =
			counts[kind] + 1, counts[kind + 1] + 1, counts[kind + 2] + 1
	end
	if counts[kind] >= 1 then
		counts[kind] = counts[kind] - 1
		add_candidate(wait_component_signature(counts, first, last, sequences, complete_cache), 0, 1, relative_kind)
		counts[kind] = counts[kind] + 1
	end
	if counts[kind] >= 2 then
		counts[kind] = counts[kind] - 2
		add_candidate(wait_component_signature(counts, first, last, sequences, complete_cache), 1, 0, relative_kind)
		counts[kind] = counts[kind] + 2
	end
	if sequences then
		if kind > first and counts[kind + 1] > 0 then
			counts[kind], counts[kind + 1] = counts[kind] - 1, counts[kind + 1] - 1
			add_candidate(wait_component_signature(counts, first, last, sequences, complete_cache), 1, 0, relative_kind - 1)
			counts[kind], counts[kind + 1] = counts[kind] + 1, counts[kind + 1] + 1
		end
		if kind <= last - 2 and counts[kind + 2] > 0 then
			counts[kind], counts[kind + 2] = counts[kind] - 1, counts[kind + 2] - 1
			add_candidate(wait_component_signature(counts, first, last, sequences, complete_cache), 1, 0, relative_kind + 1)
			counts[kind], counts[kind + 2] = counts[kind] + 1, counts[kind + 2] + 1
		end
		if kind <= last - 1 and counts[kind + 1] > 0 then
			counts[kind], counts[kind + 1] = counts[kind] - 1, counts[kind + 1] - 1
			add_candidate(wait_component_signature(counts, first, last, sequences, complete_cache), 1, 0, relative_kind + 2)
			counts[kind], counts[kind + 1] = counts[kind] + 1, counts[kind + 1] + 1
		end
	end
	added_cache[code] = result
	return result
end

local function wait_standard_win(component_signatures, needed_groups)
	local possible = { [0] = true }
	for _, signature in ipairs(component_signatures) do
		local next_possible = {}
		for key in pairs(possible) do
			local groups, pair = math.floor(key / 2), key % 2
			for component_groups = 0, needed_groups - groups do
				for component_pair = 0, 1 - pair do
					if wait_signature_has(signature, component_groups, component_pair) then
						next_possible[(groups + component_groups) * 2 + pair + component_pair] = true
					end
				end
			end
		end
		possible = next_possible
	end
	return possible[needed_groups * 2 + 1] == true
end

local function wait_is_seven_pairs(counts)
	local pairs = 0
	for kind = 1, 34 do
		if counts[kind] == 2 then
			pairs = pairs + 1
		elseif counts[kind] ~= 0 then
			return false
		end
	end
	return pairs == 7
end

local function wait_is_thirteen_orphans(counts)
	local unique, pair = 0, false
	for kind = 1, 34 do
		if counts[kind] > 0 then
			if not is_outside(kind) then
				return false
			end
			unique = unique + 1
			if counts[kind] >= 2 then
				pair = true
			end
		end
	end
	return unique == 13 and pair
end

local function waiting_types(hand, melds, mode)
	local meld_count = #(melds or {})
	if #hand ~= (4 - meld_count) * 3 + 1 then
		return {}
	end
	local counts, locked_counts = type_counts(hand), type_counts(hand)
	for _, meld in ipairs(melds or {}) do
		for _, tile in ipairs(meld.tiles or {}) do
			local kind = tile_type(tile)
			locked_counts[kind] = locked_counts[kind] + 1
		end
	end
	local complete_caches, added_caches = { {}, {}, {}, {} }, { {}, {}, {}, {} }
	local components = {
		{ first = 1, last = 9, sequences = true },
		{ first = 10, last = 18, sequences = true },
		{ first = 19, last = 27, sequences = true },
		{ first = 28, last = 34, sequences = false },
	}
	local component_signatures = {}
	for index, component in ipairs(components) do
		component_signatures[index] = wait_component_signature(
			counts, component.first, component.last, component.sequences, complete_caches[index]
		)
	end
	local needed_groups = 4 - meld_count
	local stop_after_any = mode == "any"
	local waits = {}
	for component_index, component in ipairs(components) do
		local added_signatures = wait_added_component_signatures(
			counts,
			component.first,
			component.last,
			component.sequences,
			complete_caches[component_index],
			added_caches[component_index]
		)
		local prior_signature = component_signatures[component_index]
		for signature_index, tile_mask in pairs(added_signatures) do
			component_signatures[component_index] = WAIT_SIGNATURE_BITS[signature_index]
			if wait_standard_win(component_signatures, needed_groups) then
				for relative_kind = 1, component.last - component.first + 1 do
					local kind = component.first + relative_kind - 1
					-- A wait may be exhausted in the wall or other players' hands and still
					-- count as tenpai, but it may never require a fifth physical copy already
					-- locked in this player's concealed hand and fixed groups.
					if locked_counts[kind] < 4 and wait_mask_has(tile_mask, relative_kind) then
						if stop_after_any then
							component_signatures[component_index] = prior_signature
							return { kind }
						end
						waits[kind] = true
					end
				end
			end
		end
		component_signatures[component_index] = prior_signature
	end
	if meld_count == 0 then
		for kind = 1, 34 do
			if locked_counts[kind] < 4 then
				counts[kind] = counts[kind] + 1
				if wait_is_seven_pairs(counts) or wait_is_thirteen_orphans(counts) then
					if stop_after_any then
						counts[kind] = counts[kind] - 1
						return { kind }
					end
					waits[kind] = true
				end
				counts[kind] = counts[kind] - 1
			end
		end
	end
	local result = {}
	for kind = 1, 34 do
		if waits[kind] then
			result[#result + 1] = kind
		end
	end
	return result
end

-- Late-wall clients may attach a structural tenpai declaration to their own
-- discard.  The room keeps one declaration per player and only falls back to
-- `waiting_types` for a player whose declaration no longer matches their
-- current concealed hand and melds.
local function tenpai_hand_key(hand, melds)
	local hand_counts, meld_counts = type_counts(hand), {}
	for kind = 1, 34 do
		meld_counts[kind] = 0
	end
	for _, meld in ipairs(melds or {}) do
		for _, tile in ipairs(meld.tiles or {}) do
			local kind = tile_type(tile)
			meld_counts[kind] = meld_counts[kind] + 1
		end
	end
	return table.concat(hand_counts, ",") .. ":" .. table.concat(meld_counts, ",")
end

local function tenpai_report_witness_valid(report, hand, melds)
	if type(report) ~= "table" or report.tenpai ~= true or type(report.witness) ~= "table" then
		return false
	end
	local witness, kind = report.witness, math.floor(tonumber(report.witness.kind) or 0)
	if kind < 1 or kind > 34 then
		return false
	end
	local locked_counts = type_counts(hand)
	for _, meld in ipairs(melds or {}) do
		for _, tile in ipairs(meld.tiles or {}) do
			local tile_kind = tile_type(tile)
			locked_counts[tile_kind] = locked_counts[tile_kind] + 1
		end
	end
	if locked_counts[kind] >= 4 then
		return false
	end
	local counts = type_counts(hand)
	counts[kind] = counts[kind] + 1
	if witness.form ~= "standard" then
		return false
	end
	local pair = math.floor(tonumber(witness.pair) or 0)
	local groups = witness.groups
	if pair < 1 or pair > 34 or type(groups) ~= "table" then
		return false
	end
	if #groups ~= 4 - #(melds or {}) then
		return false
	end
	local function take(tile_kind, amount)
		if not tile_kind or counts[tile_kind] < amount then
			return false
		end
		counts[tile_kind] = counts[tile_kind] - amount
		return true
	end
	if not take(pair, 2) then
		return false
	end
	for _, group in ipairs(groups) do
		local group_kind, tile = group and group.kind, math.floor(tonumber(group and group.tile) or 0)
		if group_kind == "triplet" then
			if tile < 1 or tile > 34 or not take(tile, 3) then
				return false
			end
		elseif group_kind == "sequence" then
			local rank = tile and ((tile - 1) % 9) + 1 or 0
			if tile < 1 or tile > 27 or rank > 7
				or not take(tile, 1) or not take(tile + 1, 1) or not take(tile + 2, 1) then
				return false
			end
		else
			return false
		end
	end
	for tile_kind = 1, 34 do
		if counts[tile_kind] ~= 0 then
			return false
		end
	end
	return true
end

local function normalized_tenpai_report(report, hand, melds)
	if type(report) ~= "table" or report.key ~= tenpai_hand_key(hand, melds) then
		return nil
	end
	if report.tenpai == false then
		report.waits = {}
		return report
	end
	if not tenpai_report_witness_valid(report, hand, melds) then
		return nil
	end
	report.waits = type(report.waits) == "table" and report.waits or { report.witness.kind }
	return report
end

local function tenpai_report_for(state, player_id)
	local pending = state.pendingTenpaiReport
	if pending and pending.playerId == player_id then
		state.pendingTenpaiReport = nil
		local report = normalized_tenpai_report(pending.report, state.hands[player_id], state.melds[player_id])
		return report
	end
	local report = state.tenpaiReports and state.tenpaiReports[player_id]
	return normalized_tenpai_report(report, state.hands[player_id], state.melds[player_id])
end

-- The room runtime reconstructs Lua tables from persisted JSON for every
-- call, so a Lua-global cache cannot survive from one discard to the next.
-- Keep only final-four-discard results in the serializable hand state.  A
-- player-supplied declaration is preferred when structurally valid; otherwise
-- the room calculates that one player's result at their final discard.
function late_wall_waits_for(state, player_id)
	local hand, melds = state.hands[player_id], state.melds[player_id]
	local key = tenpai_hand_key(hand, melds)
	local stored = state.lateWallWaits and state.lateWallWaits[player_id]
	if stored and stored.key == key and type(stored.waits) == "table" then
		return stored.waits
	end
	local report = tenpai_report_for(state, player_id)
	local waits
	if report then
		waits = report.tenpai and report.waits or {}
	else
		waits = waiting_types(hand, melds)
	end
	state.lateWallWaits = state.lateWallWaits or {}
	state.lateWallWaits[player_id] = { key = key, waits = waits }
	return waits
end

local function wait_shape_quality(hand, melds, winning_kind)
	local candidate = copy_array(hand)
	candidate[#candidate + 1] = (winning_kind - 1) * 4 + 1
	if is_seven_pairs(candidate, melds) then
		return 0.84
	end
	if is_thirteen_orphans(candidate, melds) then
		return 1.14
	end
	local best = 0.74
	for _, decomposition in ipairs(standard_decompositions(candidate, melds)) do
		local pair_count, sequence_quality = 0, 0
		if decomposition.pair == winning_kind then
			pair_count = 1
		end
		for _, group in ipairs(decomposition.groups) do
			if group.kind == "triplet" and group.tile == winning_kind then
				pair_count = pair_count + 1
			end
			if group.kind == "sequence" and winning_kind >= group.tile and winning_kind <= group.tile + 2 then
				local position = winning_kind - group.tile
				local start_rank = ((group.tile - 1) % 9) + 1
				if (start_rank == 1 and position == 2) or (start_rank == 7 and position == 0) then
					sequence_quality = math.max(sequence_quality, 0.70)
				elseif position == 1 then
					sequence_quality = math.max(sequence_quality, 1.08)
				else
					sequence_quality = math.max(sequence_quality, 0.82)
				end
			end
		end
		if sequence_quality > 0 then
			best = math.max(best, sequence_quality)
		elseif pair_count >= 2 then
			best = math.max(best, 0.94)
		elseif pair_count == 1 then
			best = math.max(best, 0.78)
		end
	end
	return best
end

local function tenpai_wait_profile(state, seat, hand, melds, visible_counts, discarded_kind)
	local player_id = state.players[seat]
	local discarded = {}
	for _, discard in ipairs(state.discards[player_id] or {}) do
		discarded[tile_type(discard.tile)] = true
	end
	if discarded_kind then
		discarded[discarded_kind] = true
	end
	local waits, copies, quality, furiten = waiting_types(hand, melds), 0, 0, false
	for _, kind in ipairs(waits) do
		local remaining = math.max(0, 4 - (visible_counts[kind] or 0))
		copies = copies + remaining
		quality = quality + remaining * wait_shape_quality(hand, melds, kind)
		if discarded[kind] then
			furiten = true
		end
	end
	-- Furiten still permits tsumo, but turns a normally meaningful ron share
	-- of a wait into dead value.  This is intentionally a modest discount: it
	-- should not make a broad self-drawable wait look like zero ukeire.
	if furiten then
		quality = quality * 0.62
	end
	return { count = copies, quality = quality, kinds = #waits, furiten = furiten }
end

local function remove_tile(hand, tile)
	for index, candidate in ipairs(hand) do
		if candidate == tile then
			table.remove(hand, index)
			return true
		end
	end
	return false
end

local function hand_with_drawn(state, player_id)
	local hand = copy_array(state.hands[player_id])
	if state.drawnTile and state.drawnTile > 0 and state.players[state.turnIndex] == player_id then
		hand[#hand + 1] = state.drawnTile
	end
	return hand
end

local function remove_concealed_tile(state, player_id, tile)
	if state.players[state.turnIndex] == player_id and state.drawnTile == tile then
		state.drawnTile = 0
		return true
	end
	return remove_tile(state.hands[player_id], tile)
end

local function tiles_of_type(hand, kind, maximum)
	local result = {}
	for _, tile in ipairs(hand) do
		if tile_type(tile) == kind then
			result[#result + 1] = tile
			if maximum and #result >= maximum then
				break
			end
		end
	end
	return result
end

local function next_dora(kind)
	if kind <= 27 then
		local first = math.floor((kind - 1) / 9) * 9 + 1
		return first + (((kind - first) + 1) % 9)
	end
	if kind <= 31 then
		return 28 + ((kind - 28 + 1) % 4)
	end
	return 32 + ((kind - 32 + 1) % 3)
end

local function round_up_100(value)
	return math.ceil(value / 100) * 100
end

local function all_tile_ids(hand, melds)
	local result = copy_array(hand)
	for _, meld in ipairs(melds or {}) do
		for _, tile in ipairs(meld.tiles) do
			result[#result + 1] = tile
		end
	end
	return result
end

local PAIPU = { reasons = {
	["九种九牌"] = "nine_terminals",
	["四杠散了"] = "four_kans_exhausted",
	["四家立直"] = "four_riichi",
	["四风连打"] = "four_winds_first_discards",
	["三家和"] = "triple_ron",
	["击飞结束"] = "bankruptcy",
	["庄家止和"] = "agari_yame",
	["对局结束"] = "match_complete",
	["延长赛结束"] = "extension_complete",
	}, limits = {
	[""] = "none",
	["满贯"] = "mangan",
	["跳满"] = "haneman",
	["倍满"] = "baiman",
	["三倍满"] = "sanbaiman",
	["累计役满"] = "kazoe_yakuman",
	["役满"] = "yakuman",
	}, yaku = {
		["两立直"] = "double_riichi", ["立直"] = "riichi", ["一发"] = "ippatsu",
		["门前清自摸和"] = "menzen_tsumo", ["岭上开花"] = "rinshan", ["抢杠"] = "chankan",
		["海底摸月"] = "haitei", ["河底捞鱼"] = "houtei", ["天和"] = "tenhou", ["地和"] = "chiihou",
		["九莲宝灯"] = "chuuren_poutou", ["断幺九"] = "tanyao", ["平和"] = "pinfu",
		["二杯口"] = "ryanpeikou", ["一杯口"] = "iipeikou", ["白"] = "haku", ["发"] = "hatsu", ["中"] = "chun",
		["自风"] = "jikaze", ["场风"] = "bakaze", ["大三元"] = "daisangen", ["大四喜"] = "daisuushi",
		["小四喜"] = "shousuushi", ["小三元"] = "shousangen", ["对对和"] = "toitoi", ["三暗刻"] = "sanankou",
		["四暗刻"] = "suuankou", ["三杠子"] = "sankantsu", ["四杠子"] = "suukantsu", ["三色同顺"] = "sanshoku_doujun",
		["一气通贯"] = "ittsuu", ["三色同刻"] = "sanshoku_doukou", ["混一色"] = "honitsu", ["清一色"] = "chinitsu",
		["混老头"] = "honroutou", ["混全带幺九"] = "honchantaiyaochuu", ["纯全带幺九"] = "junchantaiyaochuu",
		["字一色"] = "tsuuiisou", ["清老头"] = "chinroutou", ["绿一色"] = "ryuuiisou", ["国士无双"] = "kokushi_musou",
		["七对子"] = "chiitoitsu", ["宝牌"] = "dora", ["流局满贯"] = "nagashi_mangan",
	}, }

function PAIPU.reason_id(reason)
	if reason == nil or reason == "" then
		return nil
	end
	local id = PAIPU.reasons[reason]
	if not id then
		error("Unknown paipu reason: " .. tostring(reason))
	end
	return id
end

function PAIPU.limit(result)
	local label = type(result) == "table" and result.limit or ""
	if type(label) ~= "string" then
		label = ""
	end
	if label ~= "" and not PAIPU.limits[label] then
		local units = string.match(label, "^(%d+)倍役满$")
		if units then
			return { id = "yakuman", yakumanUnits = tonumber(units) }
		end
		error("Unknown paipu limit: " .. tostring(label))
	end
	return {
		id = PAIPU.limits[label] or "none",
		yakumanUnits = tonumber(result and result.yakuman) or 0,
	}
end

function PAIPU.payment(result, kind, winner_index)
	local payments = {}
	if type(result) ~= "table" then
		return payments
	end
	for _, edge in ipairs(result.paymentEdges or {}) do
		payments[#payments + 1] = {
			fromSeat = tonumber(edge.fromSeat) or 0,
			toSeat = tonumber(edge.toSeat) or winner_index or 0,
			amount = tonumber(edge.amount) or 0,
			kind = edge.kind or kind or "win",
		}
	end
	return payments
end

function PAIPU.result(result, kind)
	if type(result) ~= "table" then
		return nil
	end
	local winner_index = tonumber(result.winnerIndex)
	local normalized = {}
	for key, value in pairs(result) do
		if key ~= "name" and key ~= "reason" and key ~= "limit" and key ~= "payment" and key ~= "paymentEdges" and key ~= "yaku" then
			normalized[key] = copy_record_value(value)
		end
	end
	normalized.limit = PAIPU.limit(result)
	normalized.payments = PAIPU.payment(result, kind, winner_index)
	if type(result.reason) == "string" and result.reason ~= "" then
		normalized.reasonId = PAIPU.reason_id(result.reason)
	end
	if type(result.yaku) == "table" then
		normalized.yaku = {}
		for _, entry in ipairs(result.yaku) do
			local id = entry and (entry.id or PAIPU.yaku[entry.name])
			if type(entry) ~= "table" or type(id) ~= "string" or type(entry.han) ~= "number" then
				error("Invalid paipu yaku")
			end
			normalized.yaku[#normalized.yaku + 1] = { id = id, han = entry.han }
		end
	end
	return normalized
end

local function add_yaku(yaku, name, han)
	yaku[#yaku + 1] = { name = name, han = han }
	return han
end

local function add_situational_yaku(state, player_id, yaku, han, method)
	if state.doubleRiichi[player_id] then
		han = han + add_yaku(yaku, "两立直", 2)
	elseif state.riichi[player_id] then
		han = han + add_yaku(yaku, "立直", 1)
	end
	if state.ippatsu[player_id] then
		han = han + add_yaku(yaku, "一发", 1)
	end
	if method == "tsumo" and is_closed_hand(state.melds[player_id]) then
		han = han + add_yaku(yaku, "门前清自摸和", 1)
	end
	if state.rinshanWin then
		han = han + add_yaku(yaku, "岭上开花", 1)
	end
	if state.chankanWin then
		han = han + add_yaku(yaku, "抢杠", 1)
	end
	if #state.wall == 0 then
		if method == "tsumo" and not state.rinshanWin then
			han = han + add_yaku(yaku, "海底摸月", 1)
		elseif method == "ron" and not state.chankanWin then
			han = han + add_yaku(yaku, "河底捞鱼", 1)
		end
	end
	return han
end

local function add_first_turn_yakuman(state, seat, method, yaku)
	if method ~= "tsumo" or state.callOccurred then
		return 0
	end
	local player_id = state.players[seat]
	if not state.firstTurn[player_id] or #(state.melds[player_id] or {}) > 0 then
		return 0
	end
	if seat == state.dealerIndex then
		add_yaku(yaku, "天和", 13)
	else
		add_yaku(yaku, "地和", 13)
	end
	return 1
end

local function is_nine_gates(hand, melds)
	if #(melds or {}) ~= 0 or #hand ~= 14 then
		return false
	end
	local counts, suit
	counts = type_counts(hand)
	for kind = 1, 34 do
		if counts[kind] > 0 then
			if is_honor(kind) then
				return false
			end
			local candidate_suit = math.floor((kind - 1) / 9)
			if suit == nil then
				suit = candidate_suit
			elseif suit ~= candidate_suit then
				return false
			end
		end
	end
	if suit == nil then
		return false
	end
	local base = suit * 9
	if counts[base + 1] < 3 or counts[base + 9] < 3 then
		return false
	end
	for rank = 2, 8 do
		if counts[base + rank] < 1 then
			return false
		end
	end
	return true
end

local function indicator_types(state, ura)
	local result = {}
	local offset = ura and 2 or 1
	for index = 1, state.kanCount + 1 do
		local tile = state.deadWall[(index - 1) * 2 + offset]
		if tile then
			result[#result + 1] = tile_type(tile)
		end
	end
	return result
end

local function indicator_tiles(state, ura)
	local result = {}
	local offset = ura and 2 or 1
	for index = 1, state.kanCount + 1 do
		local tile = state.deadWall[(index - 1) * 2 + offset]
		if tile then
			result[#result + 1] = {
				type = tile_type(tile),
				red = RED_FIVES[tile] == true,
			}
		end
	end
	return result
end

local function count_dora(state, hand, melds, include_ura)
	local ids, count = all_tile_ids(hand, melds), 0
	local indicators = indicator_types(state, false)
	if include_ura then
		for _, kind in ipairs(indicator_types(state, true)) do
			indicators[#indicators + 1] = kind
		end
	end
	for _, tile in ipairs(ids) do
		if RED_FIVES[tile] then
			count = count + 1
		end
		local kind = tile_type(tile)
		for _, indicator in ipairs(indicators) do
			if kind == next_dora(indicator) then
				count = count + 1
			end
		end
	end
	return count
end

local function group_contains(group, kind)
	if group.kind == "sequence" then
		return kind >= group.tile and kind <= group.tile + 2
	end
	return group.tile == kind
end

local function wait_kind(group, winning_kind)
	if not group then
		return "tanki"
	end
	if group.kind == "triplet" then
		return "shanpon"
	end
	local rank = ((group.tile - 1) % 9) + 1
	if winning_kind == group.tile + 1 then
		return "kanchan"
	end
	if rank == 1 and winning_kind == group.tile + 2 then
		return "penchan"
	end
	if rank == 7 and winning_kind == group.tile then
		return "penchan"
	end
	return "ryanmen"
end

local function full_groups(decomposition, melds)
	local groups = {}
	for _, group in ipairs(decomposition.groups) do
		groups[#groups + 1] = group
	end
	for _, meld in ipairs(melds or {}) do
		groups[#groups + 1] = {
			kind = meld.kind == "chi" and "sequence"
				or ((meld.kind == "kan" or meld.kind == "ankan" or meld.kind == "kakan") and "quad" or "triplet"),
			tile = tile_type(meld.tiles[1]),
			open = meld.kind ~= "ankan",
		}
	end
	return groups
end

local function evaluate_standard(state, seat, hand, melds, decomposition, method, winning_kind, win_group)
	local closed = is_closed_hand(melds)
	local groups = full_groups(decomposition, melds)
	local yaku, han, yakuman = {}, 0, 0
	local player_id = state.players[seat]
	local seat_wind = 28 + ((seat - state.dealerIndex + 4) % 4)
	local round_wind = 27 + state.roundWind
	local wait = win_group == 0 and "tanki" or wait_kind(decomposition.groups[win_group], winning_kind)

	yakuman = yakuman + add_first_turn_yakuman(state, seat, method, yaku)
	if is_nine_gates(hand, melds) then
		yakuman = yakuman + 1
		add_yaku(yaku, "九莲宝灯", 13)
	end
	han = add_situational_yaku(state, player_id, yaku, han, method)

	local all_ids = all_tile_ids(hand, melds)
	local simple = true
	for _, tile in ipairs(all_ids) do
		if is_outside(tile_type(tile)) then
			simple = false
			break
		end
	end
	if simple then
		han = han + add_yaku(yaku, "断幺九", 1)
	end

	local sequences, triplets, concealed_triplets = {}, {}, 0
	local sequence_count, outside_groups, terminal_only_groups = {}, true, true
	for index, group in ipairs(groups) do
		if group.kind == "sequence" then
			sequences[#sequences + 1] = group.tile
			sequence_count[group.tile] = (sequence_count[group.tile] or 0) + 1
			local rank = ((group.tile - 1) % 9) + 1
			if rank ~= 1 and rank ~= 7 then
				outside_groups = false
			end
			terminal_only_groups = false
		else
			triplets[#triplets + 1] = group.tile
			if not is_outside(group.tile) then
				outside_groups, terminal_only_groups = false, false
			end
			local concealed = not group.open
			if method == "ron" and index == win_group and group.kind == "triplet" then
				concealed = false
			end
			if concealed then
				concealed_triplets = concealed_triplets + 1
			end
		end
	end
	if not is_outside(decomposition.pair) then
		outside_groups, terminal_only_groups = false, false
	end

	local value_pair = decomposition.pair >= 32 or decomposition.pair == seat_wind or decomposition.pair == round_wind
	if closed and #sequences == 4 and not value_pair and wait == "ryanmen" then
		han = han + add_yaku(yaku, "平和", 1)
	end
	if closed then
		local sequence_pairs = 0
		for _, count in pairs(sequence_count) do
			sequence_pairs = sequence_pairs + math.floor(count / 2)
		end
		if sequence_pairs >= 2 then
			han = han + add_yaku(yaku, "二杯口", 3)
		elseif sequence_pairs == 1 then
			han = han + add_yaku(yaku, "一杯口", 1)
		end
	end

	local dragon_triplets, wind_triplets = 0, 0
	for _, kind in ipairs(triplets) do
		if kind >= 32 then
			dragon_triplets = dragon_triplets + 1
			han = han + add_yaku(yaku, ({ [32] = "白", [33] = "发", [34] = "中" })[kind], 1)
		end
		if kind == seat_wind then
			han = han + add_yaku(yaku, "自风", 1)
		end
		if kind == round_wind then
			han = han + add_yaku(yaku, "场风", 1)
		end
		if kind >= 28 and kind <= 31 then
			wind_triplets = wind_triplets + 1
		end
	end
	if dragon_triplets == 3 then
		yakuman = yakuman + 1
		add_yaku(yaku, "大三元", 13)
	end
	if wind_triplets == 4 then
		yakuman = yakuman + 2
		add_yaku(yaku, "大四喜", 26)
	elseif wind_triplets == 3 and decomposition.pair >= 28 and decomposition.pair <= 31 then
		yakuman = yakuman + 1
		add_yaku(yaku, "小四喜", 13)
	end
	if dragon_triplets == 2 and decomposition.pair >= 32 then
		han = han + add_yaku(yaku, "小三元", 2)
	end

	if #triplets == 4 then
		han = han + add_yaku(yaku, "对对和", 2)
	end
	if concealed_triplets >= 3 then
		han = han + add_yaku(yaku, "三暗刻", 2)
	end
	if concealed_triplets == 4 and (method == "tsumo" or wait == "tanki") then
		yakuman = yakuman + 1
		add_yaku(yaku, "四暗刻", 13)
	end
	local quads = 0
	for _, group in ipairs(groups) do
		if group.kind == "quad" then
			quads = quads + 1
		end
	end
	if quads == 3 then
		han = han + add_yaku(yaku, "三杠子", 2)
	end
	if quads == 4 then
		yakuman = yakuman + 1
		add_yaku(yaku, "四杠子", 13)
	end

	for start = 1, 7 do
		if sequence_count[start] and sequence_count[start + 9] and sequence_count[start + 18] then
			han = han + add_yaku(yaku, "三色同顺", closed and 2 or 1)
			break
		end
	end
	for suit = 0, 2 do
		local base = suit * 9 + 1
		if sequence_count[base] and sequence_count[base + 3] and sequence_count[base + 6] then
			han = han + add_yaku(yaku, "一气通贯", closed and 2 or 1)
			break
		end
	end
	for rank = 1, 9 do
		local found = {}
		for _, kind in ipairs(triplets) do
			found[kind] = true
		end
		if found[rank] and found[rank + 9] and found[rank + 18] then
			han = han + add_yaku(yaku, "三色同刻", 2)
			break
		end
	end

	local has_honor, has_terminal, suits = false, false, {}
	for _, tile in ipairs(all_ids) do
		local kind = tile_type(tile)
		if is_honor(kind) then
			has_honor = true
		else
			suits[math.floor((kind - 1) / 9)] = true
			if is_terminal(kind) then
				has_terminal = true
			end
		end
	end
	local suit_count = 0
	for _ in pairs(suits) do
		suit_count = suit_count + 1
	end
	if suit_count == 1 then
		if has_honor then
			han = han + add_yaku(yaku, "混一色", closed and 3 or 2)
		else
			han = han + add_yaku(yaku, "清一色", closed and 6 or 5)
		end
	end
	if outside_groups then
		if #sequences == 0 then
			if has_honor and has_terminal then
				han = han + add_yaku(yaku, "混老头", 2)
			end
		elseif has_honor then
			han = han + add_yaku(yaku, "混全带幺九", closed and 2 or 1)
		else
			han = han + add_yaku(yaku, "纯全带幺九", closed and 3 or 2)
		end
	end

	local all_honors, all_terminals, all_green = true, true, true
	local green = { [20] = true, [21] = true, [22] = true, [24] = true, [26] = true, [33] = true }
	for _, tile in ipairs(all_ids) do
		local kind = tile_type(tile)
		if not is_honor(kind) then
			all_honors = false
		end
		if not is_terminal(kind) then
			all_terminals = false
		end
		if not green[kind] then
			all_green = false
		end
	end
	if all_honors then
		yakuman = yakuman + 1
		add_yaku(yaku, "字一色", 13)
	end
	if all_terminals then
		yakuman = yakuman + 1
		add_yaku(yaku, "清老头", 13)
	end
	if all_green then
		yakuman = yakuman + 1
		add_yaku(yaku, "绿一色", 13)
	end

	local fu = 20
	if closed and method == "ron" then
		fu = fu + 10
	end
	if method == "tsumo" and not (closed and #sequences == 4 and not value_pair and wait == "ryanmen") then
		fu = fu + 2
	end
	if decomposition.pair >= 32 then
		fu = fu + 2
	end
	if decomposition.pair == seat_wind then
		fu = fu + 2
	end
	if decomposition.pair == round_wind then
		fu = fu + 2
	end
	if wait == "tanki" or wait == "kanchan" or wait == "penchan" then
		fu = fu + 2
	end
	for index, group in ipairs(groups) do
		if group.kind ~= "sequence" then
			local open = group.open or (method == "ron" and index == win_group and group.kind == "triplet")
			local value = group.kind == "quad" and (open and 8 or 16) or (open and 2 or 4)
			if is_outside(group.tile) then
				value = value * 2
			end
			fu = fu + value
		end
	end
	if not closed and fu == 20 then
		fu = 30
	end
	fu = math.ceil(fu / 10) * 10
	return { yaku = yaku, han = han, fu = fu, yakuman = yakuman }
end

local function finalize_score(state, seat, hand, melds, evaluation)
	if evaluation.yakuman > 0 then
		local yakuman_yaku = {}
		for _, entry in ipairs(evaluation.yaku or {}) do
			if entry.han >= 13 then
				yakuman_yaku[#yakuman_yaku + 1] = entry
			end
		end
		evaluation.yaku = yakuman_yaku
		evaluation.han = evaluation.yakuman * 13
		evaluation.base = 8000 * evaluation.yakuman
		evaluation.limit = evaluation.yakuman > 1 and (tostring(evaluation.yakuman) .. "倍役满") or "役满"
		return evaluation
	end
	if evaluation.han <= 0 then
		return nil
	end
	local player_id = state.players[seat]
	local dora = count_dora(state, hand, melds, state.riichi[player_id] == true)
	if dora > 0 then
		evaluation.han = evaluation.han + add_yaku(evaluation.yaku, "宝牌", dora)
	end
	local raw = evaluation.fu * (2 ^ (evaluation.han + 2))
	if evaluation.han >= 13 then
		evaluation.base, evaluation.limit = 8000, "累计役满"
	elseif evaluation.han >= 11 then
		evaluation.base, evaluation.limit = 6000, "三倍满"
	elseif evaluation.han >= 8 then
		evaluation.base, evaluation.limit = 4000, "倍满"
	elseif evaluation.han >= 6 then
		evaluation.base, evaluation.limit = 3000, "跳满"
	elseif evaluation.han >= 5 or raw >= 2000 then
		evaluation.base, evaluation.limit = 2000, "满贯"
	else
		evaluation.base, evaluation.limit = raw, ""
	end
	return evaluation
end

local function special_score(state, seat, hand, melds, method)
	local player_id, yaku, han = state.players[seat], {}, 0
	if is_thirteen_orphans(hand, melds) then
		local yakuman = add_first_turn_yakuman(state, seat, method, yaku)
		add_yaku(yaku, "国士无双", 13)
		return { yaku = yaku, han = 13, fu = 0, yakuman = yakuman + 1 }
	end
	if not is_seven_pairs(hand, melds) then
		return nil
	end
	local yakuman = add_first_turn_yakuman(state, seat, method, yaku)
	han = add_situational_yaku(state, player_id, yaku, han, method)
	han = han + add_yaku(yaku, "七对子", 2)
	local all_ids, simple, outside = all_tile_ids(hand, melds), true, true
	local has_honor, has_terminal, all_honors, suits = false, false, true, {}
	for _, tile in ipairs(all_ids) do
		local kind = tile_type(tile)
		if is_outside(kind) then
			simple = false
		else
			outside = false
		end
		if is_honor(kind) then
			has_honor = true
		else
			all_honors = false
			suits[math.floor((kind - 1) / 9)] = true
			if is_terminal(kind) then
				has_terminal = true
			end
		end
	end
	if all_honors then
		yakuman = yakuman + 1
		add_yaku(yaku, "字一色", 13)
	end
	if simple then
		han = han + add_yaku(yaku, "断幺九", 1)
	end
	if outside and has_honor and has_terminal then
		han = han + add_yaku(yaku, "混老头", 2)
	end
	local suit_count = 0
	for _ in pairs(suits) do
		suit_count = suit_count + 1
	end
	if suit_count == 1 then
		if has_honor then
			han = han + add_yaku(yaku, "混一色", 3)
		else
			han = han + add_yaku(yaku, "清一色", 6)
		end
	end
	return { yaku = yaku, han = han, fu = 25, yakuman = yakuman }
end

local function score_hand(state, seat, winning_tile, method, hand_override, melds_override)
	local player_id = state.players[seat]
	local hand = copy_array(hand_override or state.hands[player_id])
	local melds = melds_override or state.melds[player_id]
	if method == "ron" then
		hand[#hand + 1] = winning_tile
	elseif state.drawnTile and state.drawnTile > 0 then
		hand[#hand + 1] = state.drawnTile
	end
	local special = special_score(state, seat, hand, melds, method)
	if special then
		return finalize_score(state, seat, hand, melds, special)
	end
	local best, winning_kind = nil, tile_type(winning_tile)
	for _, decomposition in ipairs(standard_decompositions(hand, melds)) do
		local candidates = {}
		for index, group in ipairs(decomposition.groups) do
			if group_contains(group, winning_kind) then
				candidates[#candidates + 1] = index
			end
		end
		if decomposition.pair == winning_kind then
			candidates[#candidates + 1] = 0
		end
		for _, win_group in ipairs(candidates) do
			local evaluated =
				evaluate_standard(state, seat, hand, melds, decomposition, method, winning_kind, win_group)
			evaluated = finalize_score(state, seat, hand, melds, evaluated)
			if
				evaluated
				and (
					not best
					or evaluated.base > best.base
					or (evaluated.base == best.base and evaluated.han > best.han)
					or (evaluated.base == best.base and evaluated.han == best.han and evaluated.fu > best.fu)
				)
			then
				best = evaluated
			end
		end
	end
	return best
end

local function is_furiten(state, player_id)
	if state.tempFuriten[player_id] or state.riichiFuriten[player_id] then
		return true
	end
	local waits, discarded = (state.riichiWaits and state.riichiWaits[player_id])
		or waiting_types(state.hands[player_id], state.melds[player_id]), {}
	for _, entry in ipairs(state.discards[player_id]) do
		discarded[tile_type(entry.tile)] = true
	end
	for _, kind in ipairs(waits) do
		if discarded[kind] then
			return true
		end
	end
	return false
end

local function clear_hand_state(state)
	state.hands, state.discards, state.melds = {}, {}, {}
	state.riichi, state.doubleRiichi, state.ippatsu = {}, {}, {}
	state.riichiWaits, state.lateWallWaits = {}, {}
	state.riichiMarkerPending = {}
	state.tempFuriten, state.riichiFuriten, state.firstTurn = {}, {}, {}
	state.pao, state.kanByPlayer, state.kuikaeForbidden = {}, {}, {}
	for _, player_id in ipairs(state.players) do
		state.hands[player_id], state.discards[player_id], state.melds[player_id] = {}, {}, {}
		state.riichi[player_id], state.doubleRiichi[player_id], state.ippatsu[player_id] = false, false, false
		state.riichiMarkerPending[player_id] = false
		state.tempFuriten[player_id], state.riichiFuriten[player_id], state.firstTurn[player_id] = false, false, true
		state.pao[player_id], state.kanByPlayer[player_id] = {}, 0
		state.kuikaeForbidden[player_id] = {}
	end
	state.drawnTile = 0
end

local function draw_tile(state, seat, rinshan)
	local tile
	if rinshan then
		tile = table.remove(state.rinshan)
		local replacement = table.remove(state.wall, 1)
		if replacement then
			state.deadWall[#state.deadWall + 1] = replacement
		end
	else
		tile = table.remove(state.wall)
	end
	if not tile then
		return nil
	end
	local player_id = state.players[seat]
	state.tempFuriten[player_id] = false
	state.drawnTile, state.rinshanWin = tile, rinshan == true
	return tile
end

local function paipu_wall(tiles)
	local codes = {}
	for index, tile in ipairs(tiles) do
		codes[index] = tile_code(tile)
	end
	return table.concat(codes)
end

-- A paipu stores the full wall as two-character tile codes.  Rebuild the
-- engine's internal tile IDs deterministically from those codes, so replay
-- never depends on the random number generator that produced the original
-- shuffle.  Identical non-red copies are interchangeable to the rules.
local function tiles_from_paipu_wall(wall)
	if type(wall) ~= "string" or #wall ~= 272 then
		return nil
	end
	local available = {}
	for tile = 1, 136 do
		local code = tile_code(tile)
		available[code] = available[code] or {}
		available[code][#available[code] + 1] = tile
	end
	local tiles = {}
	for position = 1, #wall, 2 do
		local code = string.sub(wall, position, position + 1)
		local choices = available[code]
		if not choices or #choices == 0 then
			return nil
		end
		tiles[#tiles + 1] = table.remove(choices, 1)
	end
	return tiles
end

local function start_paipu_hand(state, tiles)
	if type(state.paipu) ~= "table" then
		return
	end
	local hands = state.paipu.hands
	hands[#hands + 1] = {
		index = #hands,
		round = {
			wind = state.roundWind,
			number = state.handNumber,
			dealerSeat = state.dealerIndex,
			honba = state.honba,
			riichiSticks = state.riichiSticks,
		},
		startScores = copy_scores_for_record(state.scores),
		scoreHistoryBefore = copy_record_value(state.scoreHistory),
		wall = paipu_wall(tiles),
		commands = {},
		events = {},
	}
end

local function current_paipu_hand(state)
	local hands = state.paipu and state.paipu.hands
	return hands and hands[#hands] or nil
end

local function paipu_command(state, action, actor_id, events)
	if action.type == "discard" or action.type == "riichi" then
		local tsumogiri = false
		for _, event in ipairs(events or {}) do
			if (event.type == "discarded" or event.type == "riichi") and event.player == actor_id then
				tsumogiri = event.fromDrawn == true
				break
			end
		end
		return { type = action.type, tile = tile_code(action.tileId), tsumogiri = tsumogiri }
	end
	if action.type == "claim" then
		local selected_index = math.floor(tonumber(action.option) or 0)
		for _, claimant in ipairs(state.claimants or {}) do
			if claimant.playerId == actor_id then
				local option = claimant.options and claimant.options[selected_index]
				if option then
					local command = { type = option.kind == "kan" and "daiminkan" or option.kind }
					if option.kind ~= "ron" then
						command.tiles = {}
						for _, tile in ipairs(option.tileIds or {}) do
							command.tiles[#command.tiles + 1] = tile_code(tile)
						end
					end
					return command
				end
				break
			end
		end
		return nil
	end
	if action.type == "kan" and (action.kind == "ankan" or action.kind == "kakan") then
		local kind = math.floor(tonumber(action.tileType) or 0)
		return kind >= 1 and kind <= 34
			and { type = action.kind, tile = tile_code((kind - 1) * 4 + 1) }
			or nil
	end
	if action.type == "pass" or action.type == "tsumo" or action.type == "abort_nine" then
		return { type = action.type }
	end
	return nil
end

local function paipu_event(state, event, sequence)
	local recorded = copy_record_value(event)
	recorded.seq = sequence
	if recorded.type == "abortive_draw" and recorded.reason then
		recorded.reasonId = PAIPU.reason_id(recorded.reason)
		recorded.reason = nil
	end
	if type(event.tile) == "number" and event.tile >= 1 and event.tile <= 136 then
		recorded.tile = tile_code(event.tile)
	end
	return recorded
end

local function finish_paipu_hand(state, hand)
	if not hand or hand["end"] or state.phase ~= "hand_ended" then
		return
	end
	local winners = {}
	for _, player_id in ipairs(state.winners or {}) do
		local seat = player_index(state, player_id)
		if seat then
			winners[#winners + 1] = seat
		end
	end
	local result_kind = state.winType
	if not result_kind or result_kind == "" then
		result_kind = state.result and state.result.abortive and "abortive_draw" or "exhaustive_draw"
	end
	hand["end"] = {
		kind = result_kind,
		abortiveReasonId = PAIPU.reason_id(state.abortiveReason),
		winnerSeats = winners,
		winningTile = type(state.winningTile) == "number" and state.winningTile > 0 and tile_code(state.winningTile) or nil,
		results = {},
		scores = copy_scores_for_record(state.scores),
		matchEnded = state.matchEnded == true,
		matchEndReasonId = PAIPU.reason_id(state.endReason),
	}
	if state.result then
		hand["end"].results[#hand["end"].results + 1] = PAIPU.result(state.result, result_kind)
	end
	for _, result in ipairs(state.results or {}) do
		if result ~= state.result then
			hand["end"].results[#hand["end"].results + 1] = PAIPU.result(result, result_kind)
		end
	end
end

function record_paipu_action(state, action, actor_id, events)
	if action.type == "next_hand" or action.type == "new_match" then
		return
	end
	local hand = current_paipu_hand(state)
	if not hand then
		return
	end
	local command = paipu_command(state, action, actor_id, events)
	if command then
		local seat = player_index(state, actor_id)
		hand.commands[#hand.commands + 1] = { seat = seat, action = command }
	end
	for _, event in ipairs(events or {}) do
		state.paipu.eventCount = state.paipu.eventCount + 1
		hand.events[#hand.events + 1] = paipu_event(state, event, state.paipu.eventCount)
	end
	finish_paipu_hand(state, hand)
end

local function deal(state)
	local replay_wall = state.replayWall
	local tiles = replay_wall and tiles_from_paipu_wall(replay_wall) or shuffled_tiles(state)
	if not tiles then
		error("Invalid paipu wall")
	end
	if replay_wall then
		state.replayWall = nil
	end
	start_paipu_hand(state, tiles)
	clear_hand_state(state)
	state.wall, state.deadWall, state.rinshan = tiles, {}, {}
	for _ = 1, 13 do
		for _, player_id in ipairs(state.players) do
			state.hands[player_id][#state.hands[player_id] + 1] = table.remove(state.wall)
		end
	end
	for _ = 1, 10 do
		state.deadWall[#state.deadWall + 1] = table.remove(state.wall)
	end
	for _ = 1, 4 do
		state.rinshan[#state.rinshan + 1] = table.remove(state.wall)
	end
	for _, player_id in ipairs(state.players) do
		sort_hand(state.hands[player_id])
	end
	state.kanCount, state.callOccurred = 0, false
	state.pendingKan, state.pendingFourKans = nil, false
	state.claimants, state.claimResponses, state.claimIndex = {}, {}, 0
	state.lastDiscard, state.drawnTile, state.rinshanWin = nil, 0, false
	state.winner, state.winnerIndex, state.winType, state.winningTile = "", 0, "", 0
	state.winners, state.results, state.abortiveReason = {}, {}, ""
	state.abortivePlayerIndex, state.abortiveTile = 0, 0
	state.draw, state.result, state.moveCount = false, nil, 0
	state.tenpaiReports, state.pendingTenpaiReport = {}, nil
	state.chankanWin = false
	state.turnIndex, state.phase = state.dealerIndex, "playing"
	draw_tile(state, state.dealerIndex, false)
end

local function match_limit(state)
	return state.matchType == "hanchan" and 2 or 1
end

local function mark_next_hand(state, dealer_repeats, was_draw)
	state.nextDealerRepeats = dealer_repeats
	local dealer, hand, wind, honba = state.dealerIndex, state.handNumber, state.roundWind, state.honba
	if dealer_repeats then
		honba = honba + 1
	else
		dealer = (dealer % 4) + 1
		hand = hand + 1
		if hand > 4 then
			hand, wind = 1, wind + 1
		end
		honba = was_draw and honba + 1 or 0
	end
	state.nextDealerIndex, state.nextHandNumber = dealer, hand
	state.nextRoundWind, state.nextHonba = wind, honba
	local top_seat, top_score = 1, state.scores[1]
	for seat = 2, 4 do
		if state.scores[seat] > top_score then
			top_seat, top_score = seat, state.scores[seat]
		end
	end
	state.matchEnded, state.endReason = false, ""
	if state.rules.bankruptcy then
		for seat = 1, 4 do
			if state.scores[seat] < 0 then
				state.matchEnded, state.endReason = true, "击飞结束"
				break
			end
		end
	end
	local limit = match_limit(state)
	local scheduled_final = state.roundWind == limit and state.handNumber == 4
	local extension_stage = state.roundWind > limit
	if
		not state.matchEnded
		and dealer_repeats
		and state.rules.agariYame
		and not (state.result and state.result.abortive)
		and (scheduled_final or (extension_stage and not was_draw))
		and top_seat == state.dealerIndex
		and top_score >= 30000
	then
		state.matchEnded, state.endReason = true, "庄家止和"
	end
	if not state.matchEnded and not dealer_repeats and (scheduled_final or extension_stage) then
		local reached_target = top_score >= 30000 and (scheduled_final or not was_draw)
		if not state.rules.extensions or reached_target then
			state.matchEnded, state.endReason = true, "对局结束"
		elseif state.roundWind >= limit + 1 and state.handNumber == 4 then
			state.matchEnded, state.endReason = true, "延长赛结束"
		end
	end
	if not state.matchEnded and wind > limit + 1 then
		state.matchEnded, state.endReason = true, "延长赛结束"
	end
	if state.matchEnded and state.riichiSticks > 0 then
		local award = state.riichiSticks * 1000
		state.scores[top_seat], state.riichiSticks = state.scores[top_seat] + award, 0
		if state.result then
			state.result.endRiichiAward = award
			state.result.paymentEdges = state.result.paymentEdges or {}
			state.result.paymentEdges[#state.result.paymentEdges + 1] = {
				fromSeat = 0, toSeat = top_seat, amount = award, kind = "riichi_sticks",
			}
			if state.result.deltas then
				state.result.deltas[top_seat] = state.result.deltas[top_seat] + award
			end
		end
	end
end

local function copy_scores(scores)
	return { scores[1], scores[2], scores[3], scores[4] }
end

local function record_score_history(state)
	-- 途中流局不落在记分纸上。即使其前有立直棒，下一次实际结算
	-- 仍会相对上一条已记下的总分显示变化。
	if state.result and state.result.abortive then
		return
	end
	local history = state.scoreHistory or {}
	local previous = history[#history]
	local changed = previous == nil
	for seat = 1, 4 do
		if not previous or state.scores[seat] ~= previous.scores[seat] then
			changed = true
			break
		end
	end
	if not changed then
		return
	end
	history[#history + 1] = {
		roundWind = state.roundWind,
		handNumber = state.handNumber,
		honba = state.honba,
		scores = copy_scores(state.scores),
	}
	state.scoreHistory = history
end

local function pao_liabilities_for_score(state, player_id, score)
	if not state.rules.pao or not score or (score.yakuman or 0) == 0 then
		return {}
	end
	local recorded, result, by_seat = state.pao[player_id] or {}, {}, {}
	local keys = { ["大三元"] = "daisangen", ["大四喜"] = "daisuushi", ["四杠子"] = "suukantsu" }
	for _, yaku in ipairs(score.yaku or {}) do
		local seat = recorded[keys[yaku.name]]
		if seat then
			local units = math.max(1, math.floor((yaku.han or 13) / 13))
			if by_seat[seat] then
				by_seat[seat].units = by_seat[seat].units + units
			else
				local entry = { seat = seat, units = units }
				by_seat[seat], result[#result + 1] = entry, entry
			end
		end
	end
	return result
end

local function base_payment_total(score, dealer_win, method)
	if method == "ron" then
		return round_up_100(score.base * (dealer_win and 6 or 4))
	end
	if dealer_win then
		return round_up_100(score.base * 2) * 3
	end
	return round_up_100(score.base * 2) + round_up_100(score.base) * 2
end

local function add_payment(deltas, winner, payer, amount, payments, kind)
	if amount <= 0 then
		return
	end
	deltas[payer], deltas[winner] = deltas[payer] - amount, deltas[winner] + amount
	if payments then
		payments[#payments + 1] = { fromSeat = payer, toSeat = winner, amount = amount, kind = kind or "win" }
	end
end

local function add_tsumo_base_payments(state, deltas, winner, base, payments)
	local dealer_win = winner == state.dealerIndex
	for payer = 1, 4 do
		if payer ~= winner then
			local multiplier = dealer_win and 2 or (payer == state.dealerIndex and 2 or 1)
				add_payment(deltas, winner, payer, round_up_100(base * multiplier), payments, "win")
		end
	end
end

local function score_payment_deltas(state, score, seat, method, from_seat)
	local deltas, payments, dealer_win = { 0, 0, 0, 0 }, {}, seat == state.dealerIndex
	local liabilities = pao_liabilities_for_score(state, state.players[seat], score)
	local liable_units = 0
	for _, liability in ipairs(liabilities) do
		liable_units = liable_units + liability.units
	end
	liable_units = math.min(score.yakuman or 0, liable_units)

	if method == "ron" then
		if liable_units > 0 then
			local unit_value = dealer_win and 48000 or 32000
			local applied = 0
			for _, liability in ipairs(liabilities) do
				local units = math.min(liability.units, liable_units - applied)
				if units > 0 then
					local amount = unit_value * units
					if liability.seat == from_seat then
						add_payment(deltas, seat, from_seat, amount, payments, "win")
					else
						add_payment(deltas, seat, liability.seat, amount / 2, payments, "win")
						add_payment(deltas, seat, from_seat, amount / 2, payments, "win")
					end
					applied = applied + units
				end
			end
			local ordinary_units = math.max(0, (score.yakuman or 0) - applied)
			add_payment(deltas, seat, from_seat, unit_value * ordinary_units, payments, "win")
			-- Honba is never split with the liable player on a ron win.
				add_payment(deltas, seat, from_seat, state.honba * 300, payments, "honba")
		else
			local amount = round_up_100(score.base * (dealer_win and 6 or 4)) + state.honba * 300
			add_payment(deltas, seat, from_seat, amount - state.honba * 300, payments, "win")
			add_payment(deltas, seat, from_seat, state.honba * 300, payments, "honba")
		end
	elseif liable_units > 0 then
		local unit_value, applied = dealer_win and 48000 or 32000, 0
		for _, liability in ipairs(liabilities) do
			local units = math.min(liability.units, liable_units - applied)
			if units > 0 then
				add_payment(deltas, seat, liability.seat, unit_value * units, payments, "win")
				applied = applied + units
			end
		end
		local ordinary_units = math.max(0, (score.yakuman or 0) - applied)
		if ordinary_units > 0 then
			add_tsumo_base_payments(state, deltas, seat, 8000 * ordinary_units, payments)
		end
		if ordinary_units == 0 and #liabilities == 1 then
			add_payment(deltas, seat, liabilities[1].seat, state.honba * 300, payments, "honba")
		else
			for payer = 1, 4 do
				if payer ~= seat then
					add_payment(deltas, seat, payer, state.honba * 100, payments, "honba")
				end
			end
		end
	else
		add_tsumo_base_payments(state, deltas, seat, score.base, payments)
		for payer = 1, 4 do
			if payer ~= seat then
				add_payment(deltas, seat, payer, state.honba * 100, payments, "honba")
			end
		end
	end

	score.paoSeat, score.paoSeats = 0, {}
	for _, liability in ipairs(liabilities) do
		if score.paoSeat == 0 then
			score.paoSeat = liability.seat
		end
		score.paoSeats[#score.paoSeats + 1] = liability.seat
	end
	score.basePaymentTotal = base_payment_total(score, dealer_win, method)
	score.paymentEdges = payments
	score.payment = tostring(deltas[seat]) .. "点"
	return deltas
end

local function settle_win(state, seat, method, from_seat, winning_tile)
	local score = score_hand(state, seat, winning_tile, method)
	if not score then
		return nil
	end
	local deltas = score_payment_deltas(state, score, seat, method, from_seat)
	local dealer_win = seat == state.dealerIndex
	if state.riichiSticks > 0 then
		deltas[seat] = deltas[seat] + state.riichiSticks * 1000
		score.riichiAward = state.riichiSticks * 1000
		score.paymentEdges[#score.paymentEdges + 1] = {
			fromSeat = 0, toSeat = seat, amount = score.riichiAward, kind = "riichi_sticks",
		}
		state.riichiSticks = 0
	end
	for index = 1, 4 do
		state.scores[index] = state.scores[index] + deltas[index]
	end
	score.deltas = deltas
	state.phase, state.winner, state.winnerIndex = "hand_ended", state.players[seat], seat
	state.winType, state.winningTile, state.draw = method, winning_tile, false
	state.winners, state.results, state.result = { state.players[seat] }, { score }, score
	mark_next_hand(state, dealer_win, false)
	record_score_history(state)
	return score
end

local function settle_multiple_ron(state, winners, from_seat, winning_tile)
	local total_deltas, results, winner_ids = { 0, 0, 0, 0 }, {}, {}
	local dealer_won = false
	for _, winner in ipairs(winners) do
		local seat = winner.playerIndex
		local score = score_hand(state, seat, winning_tile, "ron")
		if score then
			local deltas = score_payment_deltas(state, score, seat, "ron", from_seat)
			for index = 1, 4 do
				total_deltas[index] = total_deltas[index] + deltas[index]
			end
			score.winnerIndex = seat
			results[#results + 1], winner_ids[#winner_ids + 1] = score, state.players[seat]
			if seat == state.dealerIndex then
				dealer_won = true
			end
		end
	end
	if #results == 0 then
		return false
	end
	if state.riichiSticks > 0 then
		local award = state.riichiSticks * 1000
		total_deltas[results[1].winnerIndex] = total_deltas[results[1].winnerIndex] + award
		results[1].riichiAward, state.riichiSticks = award, 0
		results[1].paymentEdges[#results[1].paymentEdges + 1] = {
			fromSeat = 0, toSeat = results[1].winnerIndex, amount = award, kind = "riichi_sticks",
		}
	end
	for seat = 1, 4 do
		state.scores[seat] = state.scores[seat] + total_deltas[seat]
	end
	for _, score in ipairs(results) do
		score.deltas = total_deltas
	end
	state.phase, state.winType, state.winningTile, state.draw = "hand_ended", "ron", winning_tile, false
	state.winnerIndex, state.winner = results[1].winnerIndex, winner_ids[1]
	state.winners, state.results, state.result = winner_ids, results, results[1]
	mark_next_hand(state, dealer_won, false)
	record_score_history(state)
	return true
end

finish_exhaustive_draw = function(state)
	if state.rules.nagashiMangan then
		local winners = {}
		for seat, player_id in ipairs(state.players) do
			local eligible = #state.discards[player_id] > 0
			for _, discard in ipairs(state.discards[player_id]) do
				if discard.claimed or not is_outside(tile_type(discard.tile)) then
					eligible = false
					break
				end
			end
			if eligible then
				winners[#winners + 1] = seat
			end
		end
		if #winners > 0 then
			local deltas, results, dealer_won = { 0, 0, 0, 0 }, {}, false
			for _, seat in ipairs(winners) do
				local won, payment_edges = 0, {}
				for payer = 1, 4 do
					if payer ~= seat then
						local multiplier = seat == state.dealerIndex and 2 or (payer == state.dealerIndex and 2 or 1)
						local win_amount = round_up_100(2000 * multiplier)
						local honba_amount = state.honba * 100
						local amount = win_amount + honba_amount
						deltas[payer], won = deltas[payer] - amount, won + amount
						payment_edges[#payment_edges + 1] = { fromSeat = payer, toSeat = seat, amount = win_amount, kind = "win" }
						if honba_amount > 0 then
							payment_edges[#payment_edges + 1] = { fromSeat = payer, toSeat = seat, amount = honba_amount, kind = "honba" }
						end
					end
				end
				deltas[seat] = deltas[seat] + won
				results[#results + 1] = {
					winnerIndex = seat,
					han = 5,
					fu = 0,
					limit = "满贯",
					basePaymentTotal = seat == state.dealerIndex and 12000 or 8000,
					payment = seat == state.dealerIndex and "4000点∀" or "2000/4000点",
					paymentEdges = payment_edges,
					yaku = { { name = "流局满贯", han = 5 } },
				}
				if seat == state.dealerIndex then
					dealer_won = true
				end
			end
			if state.riichiSticks > 0 then
				local award = state.riichiSticks * 1000
				deltas[winners[1]], results[1].riichiAward, state.riichiSticks = deltas[winners[1]] + award, award, 0
				results[1].paymentEdges[#results[1].paymentEdges + 1] = {
					fromSeat = 0, toSeat = winners[1], amount = award, kind = "riichi_sticks",
				}
			end
			for seat = 1, 4 do
				state.scores[seat] = state.scores[seat] + deltas[seat]
			end
			for _, result in ipairs(results) do
				result.deltas = deltas
			end
			state.phase, state.draw, state.winType = "hand_ended", false, "nagashi"
			state.winnerIndex, state.winner = winners[1], state.players[winners[1]]
			state.winners, state.results, state.result = {}, results, results[1]
			for _, seat in ipairs(winners) do
				state.winners[#state.winners + 1] = state.players[seat]
			end
			mark_next_hand(state, dealer_won, false)
			record_score_history(state)
			return
		end
	end
	local tenpai, tenpai_waits, count = {}, {}, 0
	for seat, player_id in ipairs(state.players) do
		local waits = late_wall_waits_for(state, player_id)
		tenpai[seat] = #waits > 0
		tenpai_waits[seat] = waits
		if tenpai[seat] then
			count = count + 1
		end
	end
	local deltas, payment_edges = { 0, 0, 0, 0 }, {}
	if count > 0 and count < 4 then
		local gain, loss = 3000 / count, 3000 / (4 - count)
		for seat = 1, 4 do
			deltas[seat] = tenpai[seat] and gain or -loss
		end
		for payer = 1, 4 do
			if not tenpai[payer] then
				for receiver = 1, 4 do
					if tenpai[receiver] then
						payment_edges[#payment_edges + 1] = {
							fromSeat = payer, toSeat = receiver,
							amount = gain / (4 - count), kind = "noten_penalty",
						}
					end
				end
			end
		end
		for seat = 1, 4 do
			state.scores[seat] = state.scores[seat] + deltas[seat]
		end
	end
	state.phase, state.draw = "hand_ended", true
	state.result = {
		tenpai = tenpai,
		tenpaiWaits = tenpai_waits,
		deltas = deltas,
		paymentEdges = payment_edges,
		payment = count == 0 or count == 4 and "不听罚符 0点" or "不听罚符 3000点",
	}
	mark_next_hand(state, tenpai[state.dealerIndex], true)
	record_score_history(state)
end

finish_abortive_draw = function(state, reason, player_index)
	state.phase, state.draw = "hand_ended", true
	state.abortiveReason = reason
	state.abortivePlayerIndex = tonumber(player_index) or 0
	state.abortiveTile = state.abortivePlayerIndex > 0 and state.drawnTile or 0
	state.result = { abortive = true, reason = reason, deltas = { 0, 0, 0, 0 }, payment = "途中流局" }
	mark_next_hand(state, true, true)
end

local function new_match(players, names, seed, settings, ai_players)
	seed = math.floor(math.abs(tonumber(seed) or 1)) % RANDOM_MODULUS
	if seed == 0 then
		seed = 1
	end
	local state = {
		players = players,
		playerNames = names,
		seed = seed,
		matchType = settings and settings.matchType == "hanchan" and "hanchan" or "east",
		roundWind = 1,
		handNumber = 1,
		dealerIndex = 1,
		honba = 0,
		riichiSticks = 0,
		scores = { 25000, 25000, 25000, 25000 },
		scoreHistory = {
			{ roundWind = 1, handNumber = 1, honba = 0, scores = { 25000, 25000, 25000, 25000 } },
		},
		matchEnded = false,
		aiPlayers = ai_players or {},
		canonicalMatchSeats = settings and settings.canonicalMatchSeats == true,
		rules = rule_settings(settings),
	}
	-- A paipu viewer can start directly at any recorded hand.  The wall plus
	-- these hand-start fields are sufficient to rebuild that hand without
	-- replaying every earlier hand in the match.
	local replay_hand = settings and settings.replayHand
	if type(replay_hand) == "table" then
		local round = type(replay_hand.round) == "table" and replay_hand.round or {}
		local scores = replay_hand.startScores
		local wind = tonumber(round.wind)
		local hand = tonumber(round.number)
		local dealer = tonumber(round.dealerSeat)
		local honba = tonumber(round.honba)
		local riichi_sticks = tonumber(round.riichiSticks)
		if
			type(replay_hand.wall) ~= "string"
			or type(scores) ~= "table"
			or #scores ~= PLAYER_COUNT
			or type(scores[1]) ~= "number" or scores[1] ~= scores[1]
			or type(scores[2]) ~= "number" or scores[2] ~= scores[2]
			or type(scores[3]) ~= "number" or scores[3] ~= scores[3]
			or type(scores[4]) ~= "number" or scores[4] ~= scores[4]
			or not wind or wind < 1 or wind % 1 ~= 0
			or not hand or hand < 1 or hand > 4 or hand % 1 ~= 0
			or not dealer or dealer < 1 or dealer > PLAYER_COUNT or dealer % 1 ~= 0
			or not honba or honba < 0 or honba % 1 ~= 0
			or not riichi_sticks or riichi_sticks < 0 or riichi_sticks % 1 ~= 0
		then
			error("Invalid paipu replay hand")
		end
		state.roundWind = wind
		state.handNumber = hand
		state.dealerIndex = dealer
		state.honba = honba
		state.riichiSticks = riichi_sticks
		state.scores = copy_scores_for_record(scores)
		local saved_score_history = replay_hand.scoreHistoryBefore
		state.scoreHistory = type(saved_score_history) == "table"
			and #saved_score_history > 0
			and copy_record_value(saved_score_history)
			or {
			{
				roundWind = state.roundWind,
				handNumber = state.handNumber,
				honba = state.honba,
				scores = copy_scores_for_record(state.scores),
			},
		}
	end
	state.paipu = {
		format = "longern.riichi.paipu",
		formatVersion = 3,
		initialScores = copy_scores_for_record(state.scores),
		hands = {},
		eventCount = 0,
	}
	-- Replay receives exactly one hand wall at a time.  Entering a later hand
	-- is an explicit host command, rather than preloading future hand walls.
	state.replayWall = replay_hand and replay_hand.wall or nil
	-- Drawing the east seat is equivalent to drawing all four winds: once east
	-- is known, south, west, and north follow clockwise around the fixed table.
	-- Derive the draw from the match seed without advancing the tile-shuffle RNG,
	-- so seat assignment and wall order remain independent reproducible results.
	local initial_dealer = tonumber(settings and settings.initialDealerSeat)
	if not replay_hand and initial_dealer and initial_dealer >= 1 and initial_dealer <= PLAYER_COUNT and initial_dealer % 1 == 0 then
		state.dealerIndex = initial_dealer
	elseif not replay_hand then
		local seat_draw = (state.seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
		state.dealerIndex = (seat_draw % PLAYER_COUNT) + 1
	end
	-- Canonical matches keep the player array in the opening East/South/West/North
	-- order for the whole match. A replay hand's `dealerSeat` is only this hand's
	-- dealer, never the score-sheet column origin.
	state.initialDealerIndex = state.canonicalMatchSeats and 1 or state.dealerIndex
	deal(state)
	return state
end

local function chi_tile_variants(hand, kind)
	local normal, red
	for _, tile in ipairs(hand) do
		if tile_type(tile) == kind then
			if RED_FIVES[tile] then
				red = red or tile
			else
				normal = normal or tile
			end
		end
	end
	local variants = {}
	if normal then
		variants[#variants + 1] = normal
	end
	if red then
		variants[#variants + 1] = red
	end
	return variants
end

local function chi_options(hand, discarded_type)
	if discarded_type > 27 then
		return {}
	end
	local rank = ((discarded_type - 1) % 9) + 1
	local candidates = {
		{ discarded_type - 2, discarded_type - 1, rank >= 3 },
		{ discarded_type - 1, discarded_type + 1, rank >= 2 and rank <= 8 },
		{ discarded_type + 1, discarded_type + 2, rank <= 7 },
	}
	local options = {}
	for _, candidate in ipairs(candidates) do
		if candidate[3] then
			local first_variants = chi_tile_variants(hand, candidate[1])
			local second_variants = chi_tile_variants(hand, candidate[2])
			for _, first in ipairs(first_variants) do
				for _, second in ipairs(second_variants) do
					options[#options + 1] = { kind = "chi", tileIds = { first, second } }
				end
			end
		end
	end
	return options
end

local function pon_options(hand, kind)
	local normal, red = {}, nil
	for _, tile in ipairs(hand) do
		if tile_type(tile) == kind then
			if RED_FIVES[tile] then
				red = red or tile
			else
				normal[#normal + 1] = tile
			end
		end
	end
	local options = {}
	if #normal >= 2 then
		options[#options + 1] = { kind = "pon", tileIds = { normal[1], normal[2] } }
	end
	if #normal >= 1 and red then
		options[#options + 1] = { kind = "pon", tileIds = { normal[1], red } }
	end
	return options
end

local function same_kinds(left, right)
	if #left ~= #right then
		return false
	end
	local seen = {}
	for _, kind in ipairs(left) do
		seen[kind] = (seen[kind] or 0) + 1
	end
	for _, kind in ipairs(right) do
		if not seen[kind] or seen[kind] == 0 then
			return false
		end
		seen[kind] = seen[kind] - 1
	end
	return true
end

local function self_kan_options(state, player_id)
	if state.drawnTile == 0 or state.kanCount >= 4 or #state.wall == 0 then
		return {}
	end
	local hand, options = hand_with_drawn(state, player_id), {}
	local counts = type_counts(hand)
	for kind = 1, 34 do
		if counts[kind] == 4 then
			local allowed = true
			if state.riichi[player_id] then
				-- After riichi, a concealed quad must be completed by this turn's
				-- drawn tile.  Quadding four tiles that were already in the rack is
				-- the prohibited okuri-kan.
				allowed = tile_type(state.drawnTile) == kind
				if allowed then
					local before = copy_array(state.hands[player_id])
					local after = copy_array(hand)
					local kan_tiles = tiles_of_type(after, kind, 4)
					for _, tile in ipairs(kan_tiles) do
						remove_tile(after, tile)
					end
					local pseudo_melds = copy_array(state.melds[player_id])
					pseudo_melds[#pseudo_melds + 1] = { kind = "ankan", tiles = kan_tiles }
					allowed =
						same_kinds(waiting_types(before, state.melds[player_id]), waiting_types(after, pseudo_melds))
				end
			end
			if allowed then
				options[#options + 1] = { kind = "ankan", tileType = kind }
			end
		end
	end
	if not state.riichi[player_id] then
		for index, meld in ipairs(state.melds[player_id]) do
			if meld.kind == "pon" then
				local kind = tile_type(meld.tiles[1])
				if counts[kind] > 0 then
					options[#options + 1] = { kind = "kakan", tileType = kind, meldIndex = index }
				end
			end
		end
	end
	return options
end

local function record_pao(state, player_id, source_seat)
	if not state.rules.pao or not source_seat or source_seat == 0 then
		return
	end
	if state.players[source_seat] == player_id then
		return
	end
	local dragons, winds, quads = 0, 0, 0
	for _, meld in ipairs(state.melds[player_id]) do
		local kind = tile_type(meld.tiles[1])
		if meld.kind ~= "chi" and kind >= 32 then
			dragons = dragons + 1
		end
		if meld.kind ~= "chi" and kind >= 28 and kind <= 31 then
			winds = winds + 1
		end
		if meld.kind == "kan" or meld.kind == "ankan" or meld.kind == "kakan" then
			quads = quads + 1
		end
	end
	if dragons >= 3 and not state.pao[player_id].daisangen then
		state.pao[player_id].daisangen = source_seat
	end
	if winds >= 4 and not state.pao[player_id].daisuushii then
		state.pao[player_id].daisuushii = source_seat
	end
	if quads >= 4 and not state.pao[player_id].suukantsu then
		state.pao[player_id].suukantsu = source_seat
	end
end

local function draw_after_kan(state, seat, events)
	local player_id = state.players[seat]
	state.kanCount = state.kanCount + 1
	state.kanByPlayer[player_id] = state.kanByPlayer[player_id] + 1
	local owners = 0
	for _, count in pairs(state.kanByPlayer) do
		if count > 0 then
			owners = owners + 1
		end
	end
	if state.kanCount >= 4 and owners > 1 then
		state.pendingFourKans = true
	end
	local tile = draw_tile(state, seat, true)
	if tile then
		events[#events + 1] = { type = "drew", player = player_id, playerIndex = seat, tile = tile }
	else
		finish_exhaustive_draw(state)
		events[#events + 1] = { type = "draw_game" }
	end
end

local function complete_pending_kan(state, events)
	local pending = state.pendingKan
	if not pending then
		return
	end
	local player_id = pending.playerId
	local hand = hand_with_drawn(state, player_id)
	if pending.kind == "ankan" then
		for _, tile in ipairs(pending.tiles) do
			remove_tile(hand, tile)
		end
		state.melds[player_id][#state.melds[player_id] + 1] = {
			kind = "ankan",
			tiles = pending.tiles,
			fromIndex = 0,
		}
	else
		remove_tile(hand, pending.tile)
		local meld = state.melds[player_id][pending.meldIndex]
		meld.kind = "kakan"
		meld.tiles[#meld.tiles + 1] = pending.tile
		meld.addedTile = pending.tile
	end
	sort_hand(hand)
	state.hands[player_id], state.drawnTile = hand, 0
	state.pendingKan, state.phase, state.lastDiscard = nil, "playing", nil
	cancel_ippatsu(state)
	record_pao(state, player_id, pending.playerIndex)
	events[#events + 1] =
		{ type = "claimed", kind = pending.kind, player = player_id, playerIndex = pending.playerIndex }
	draw_after_kan(state, pending.playerIndex, events)
end

local function begin_chankan(state, seat, tile, meld_index, kan_kind, kan_tiles)
	state.claimants, state.claimResponses, state.claimIndex = {}, {}, 0
	state.chankanWin = true
	for distance = 1, 3 do
		local other = ((seat - 1 + distance) % 4) + 1
		local player_id = state.players[other]
		local can_ron = false
		if kan_kind == "ankan" then
			local candidate = copy_array(state.hands[player_id])
			candidate[#candidate + 1] = tile
			can_ron = is_thirteen_orphans(candidate, state.melds[player_id]) and not is_furiten(state, player_id)
		else
			local candidate = copy_array(state.hands[player_id])
			candidate[#candidate + 1] = tile
			if is_structural_win(candidate, state.melds[player_id]) and not is_furiten(state, player_id) then
				can_ron = score_hand(state, other, tile, "ron") ~= nil
			end
		end
		if can_ron then
			state.claimants[#state.claimants + 1] = {
				playerId = player_id,
				playerIndex = other,
				distance = distance,
				options = { { kind = "ron", tileIds = {} } },
			}
		end
	end
	if #state.claimants == 0 then
		state.chankanWin = false
		return false
	end
	state.pendingKan = {
		playerId = state.players[seat],
		playerIndex = seat,
		tile = tile,
		meldIndex = meld_index,
		kind = kan_kind,
		tiles = kan_tiles,
	}
	state.lastDiscard =
		{ player = state.players[seat], playerIndex = seat, tile = tile, discardIndex = 0, chankan = true }
	state.phase, state.claimIndex = "claiming", 1
	return true
end

local function apply_self_kan(state, action, actor_id, seat)
	if state.phase ~= "playing" or state.turnIndex ~= seat or state.drawnTile == 0 then
		return rejected("not_your_turn")
	end
	local selected
	for _, option in ipairs(self_kan_options(state, actor_id)) do
		if option.kind == action.kind and option.tileType == action.tileType then
			selected = option
			break
		end
	end
	if not selected then
		return rejected("kan_not_allowed")
	end
	local events = {}
	if selected.kind == "kakan" then
		local tile = tiles_of_type(hand_with_drawn(state, actor_id), selected.tileType, 1)[1]
		if begin_chankan(state, seat, tile, selected.meldIndex, "kakan") then
			return accepted(state, { { type = "kan_declared", kind = "kakan", player = actor_id, playerIndex = seat } })
		end
		state.pendingKan = {
			playerId = actor_id,
			playerIndex = seat,
			tile = tile,
			meldIndex = selected.meldIndex,
			kind = "kakan",
		}
		complete_pending_kan(state, events)
		return accepted(state, events)
	end
	local tiles = tiles_of_type(hand_with_drawn(state, actor_id), selected.tileType, 4)
	if begin_chankan(state, seat, tiles[1], 0, "ankan", tiles) then
		return accepted(state, { { type = "kan_declared", kind = "ankan", player = actor_id, playerIndex = seat } })
	end
	state.pendingKan =
		{ playerId = actor_id, playerIndex = seat, tile = tiles[1], meldIndex = 0, kind = "ankan", tiles = tiles }
	complete_pending_kan(state, events)
	return accepted(state, events)
end

local function structural_ron_available(state, seat, tile)
	local player_id = state.players[seat]
	local candidate = copy_array(state.hands[player_id])
	candidate[#candidate + 1] = tile
	return is_structural_win(candidate, state.melds[player_id])
end

local function claim_options(state, seat, discarder, tile)
	local player_id, options = state.players[seat], {}
	local hand, kind = state.hands[player_id], tile_type(tile)
	local ron_opportunity = structural_ron_available(state, seat, tile) and not is_furiten(state, player_id)
	if ron_opportunity and score_hand(state, seat, tile, "ron") then
		options[#options + 1] = { kind = "ron", tileIds = {} }
	end
	if state.riichi[player_id] or #state.wall == 0 then
		return options, ron_opportunity
	end
	local same = tiles_of_type(hand, kind, 3)
	if #same >= 3 and #state.wall > 0 and state.kanCount < 4 then
		options[#options + 1] = { kind = "kan", tileIds = { same[1], same[2], same[3] } }
	end
	if #same >= 2 then
		for _, option in ipairs(pon_options(hand, kind)) do
			options[#options + 1] = option
		end
	end
	if seat == (discarder % PLAYER_COUNT) + 1 then
		for _, option in ipairs(chi_options(hand, kind)) do
			options[#options + 1] = option
		end
	end
	return options, ron_opportunity
end

local function begin_claims(state, discarder, tile)
	state.claimants, state.claimResponses, state.claimIndex = {}, {}, 0
	for distance = 1, 3 do
		local seat = ((discarder - 1 + distance) % 4) + 1
		local options, ron_opportunity = claim_options(state, seat, discarder, tile)
		local player_id = state.players[seat]
		local auto_pass_claims = state.autoPassClaims and state.autoPassClaims[player_id] == true
		if auto_pass_claims then
			local ron_options = {}
			for _, option in ipairs(options) do
				if option.kind == "ron" then
					ron_options[#ron_options + 1] = option
				end
			end
			options = ron_options
		end
		if #options > 0 then
			state.claimants[#state.claimants + 1] = {
				playerId = player_id,
				playerIndex = seat,
				distance = distance,
				options = options,
				ronOpportunity = ron_opportunity,
			}
		elseif ron_opportunity and not auto_pass_claims then
			-- Completing a structurally valid hand without a yaku is still a
			-- missed ron opportunity and therefore creates temporary furiten.
			if state.riichi[player_id] then
				state.riichiFuriten[player_id] = true
			else
				state.tempFuriten[player_id] = true
			end
		end
	end
	if #state.claimants > 0 then
		state.phase, state.claimIndex = "claiming", 1
		return true
	end
	return false
end

local function advance_after_discard(state, discarder, events)
	if state.rules.abortiveDraws then
		local reason
		if state.pendingFourKans then
			reason = "四杠散了"
		end
		local riichi_count = 0
		for _, player_id in ipairs(state.players) do
			if state.riichi[player_id] then
				riichi_count = riichi_count + 1
			end
		end
		if riichi_count == 4 then
			reason = "四家立直"
		end
		if state.moveCount == 4 and not state.callOccurred then
			local first
			local same_wind = true
			for _, player_id in ipairs(state.players) do
				local discard = state.discards[player_id][1]
				local kind = discard and tile_type(discard.tile) or 0
				if kind < 28 or kind > 31 then
					same_wind = false
					break
				end
				if not first then
					first = kind
				elseif first ~= kind then
					same_wind = false
					break
				end
			end
			if same_wind then
				reason = "四风连打"
			end
		end
		if reason then
			finish_abortive_draw(state, reason)
			events[#events + 1] = { type = "abortive_draw", reason = reason }
			return
		end
	end
	state.turnIndex, state.phase, state.lastDiscard = (discarder % 4) + 1, "playing", nil
	local tile = draw_tile(state, state.turnIndex, false)
	if tile then
		events[#events + 1] =
			{ type = "drew", player = state.players[state.turnIndex], playerIndex = state.turnIndex, tile = tile }
	else
		finish_exhaustive_draw(state)
		events[#events + 1] = { type = "draw_game" }
	end
end

local function option_priority(kind)
	if kind == "ron" then
		return 4
	end
	if kind == "pon" or kind == "kan" then
		return 3
	end
	if kind == "chi" then
		return 2
	end
	return 0
end

local function claim_response_for(state, claimant_index)
	for _, response in ipairs(state.claimResponses or {}) do
		if response.claimant == claimant_index then
			return response
		end
	end
	return nil
end

local function pending_claimant_for_player(state, player_id)
	for index, claimant in ipairs(state.claimants or {}) do
		if claimant.playerId == player_id and not claim_response_for(state, index) then
			return index, claimant
		end
	end
	return nil, nil
end

local function claimant_priority(claimant)
	local priority = 0
	for _, option in ipairs(claimant.options or {}) do
		priority = math.max(priority, option_priority(option.kind))
	end
	return priority
end

local function highest_selected_claim_priority(state)
	local priority = 0
	for _, response in ipairs(state.claimResponses or {}) do
		if response.option > 0 then
			local claimant = state.claimants[response.claimant]
			local option = claimant and claimant.options[response.option]
			if option then
				priority = math.max(priority, option_priority(option.kind))
			end
		end
	end
	return priority
end

local function cancel_lower_priority_claims(state, selected_priority)
	if selected_priority <= 0 then
		return
	end
	for index, claimant in ipairs(state.claimants or {}) do
		if not claim_response_for(state, index) and claimant_priority(claimant) < selected_priority then
			state.claimResponses[#state.claimResponses + 1] = {
				claimant = index,
				option = 0,
				cancelled = true,
			}
		end
	end
end

local function refresh_claim_index(state)
	state.claimIndex = 0
	for index in ipairs(state.claimants or {}) do
		if not claim_response_for(state, index) then
			state.claimIndex = index
			return index
		end
	end
	return 0
end

local function kuikae_forbidden_types(option)
	local forbidden = {}
	-- Room-state serialization treats numeric-key tables as arrays.  Keep this
	-- vector dense so a forbidden tile such as kind 6 never becomes { [6] = true }
	-- at the room boundary.
	for kind = 1, 34 do
		forbidden[kind] = false
	end
	if option.kind == "pon" or option.kind == "kan" then
		local tile = option.tileIds[1]
		if tile then
			forbidden[tile_type(tile)] = true
		end
		return forbidden
	end
	if option.kind ~= "chi" then
		return forbidden
	end
	local first, second = tile_type(option.tileIds[1]), tile_type(option.tileIds[2])
	for candidate = 1, 27 do
		local values = { first, second, candidate }
		table.sort(values)
		local same_suit = math.floor((values[1] - 1) / 9) == math.floor((values[3] - 1) / 9)
		if same_suit and values[2] == values[1] + 1 and values[3] == values[2] + 1 then
			forbidden[candidate] = true
		end
	end
	return forbidden
end

cancel_ippatsu = function(state)
	state.callOccurred = true
	for _, player_id in ipairs(state.players) do
		state.ippatsu[player_id] = false
	end
end

local function rollback_ronned_riichi_declaration(state, discard)
	if not discard or not discard.riichiDeclaration then
		return
	end
	local player_id, seat = discard.player, discard.playerIndex
	state.scores[seat] = state.scores[seat] + 1000
	state.riichiSticks = math.max(0, state.riichiSticks - 1)
	state.riichi[player_id], state.doubleRiichi[player_id], state.ippatsu[player_id] = false, false, false
	-- The declaration is void and its 1000 points are returned, but its discard
	-- remains exactly where it landed in the river. Keeping the sideways marker
	-- avoids an abrupt visual "turn back" after a ron on the declaration tile.
end

local function resolve_claims(state, events)
	local winner
	local ron_winners = {}
	for _, response in ipairs(state.claimResponses) do
		if response.option > 0 then
			local claimant = state.claimants[response.claimant]
			local option = claimant.options[response.option]
			if option and option.kind == "ron" then
				ron_winners[#ron_winners + 1] = claimant
			elseif
				option
				and (
					not winner
					or option_priority(option.kind) > option_priority(winner.option.kind)
					or (
						option_priority(option.kind) == option_priority(winner.option.kind)
						and claimant.distance < winner.claimant.distance
					)
				)
			then
				winner = { claimant = claimant, option = option }
			end
		end
	end
	local discard = state.lastDiscard
	if #ron_winners > 0 then
		table.sort(ron_winners, function(a, b)
			return a.distance < b.distance
		end)
		rollback_ronned_riichi_declaration(state, discard)
		if state.rules.tripleRonAbort and #ron_winners == 3 then
			state.pendingKan, state.chankanWin = nil, false
			finish_abortive_draw(state, "三家和")
			events[#events + 1] = { type = "abortive_draw", reason = "三家和" }
			return
		end
		if not state.rules.multipleRon then
			ron_winners = { ron_winners[1] }
		end
		if state.pendingKan then
			remove_concealed_tile(state, state.pendingKan.playerId, state.pendingKan.tile)
		end
		settle_multiple_ron(state, ron_winners, discard.playerIndex, discard.tile)
		state.pendingKan, state.chankanWin = nil, false
		for _, claimant in ipairs(ron_winners) do
			events[#events + 1] = {
				type = "won",
				method = "ron",
				player = claimant.playerId,
				playerIndex = claimant.playerIndex,
				fromIndex = discard.playerIndex,
				tile = discard.tile,
			}
		end
		return
	end
	if state.pendingKan then
		complete_pending_kan(state, events)
		state.chankanWin = false
		return
	end
	if not winner then
		advance_after_discard(state, discard.playerIndex, events)
		return
	end
	local claimant, option = winner.claimant, winner.option
	cancel_ippatsu(state)
	local hand, meld_tiles = state.hands[claimant.playerId], { discard.tile }
	for _, tile in ipairs(option.tileIds) do
		remove_tile(hand, tile)
		meld_tiles[#meld_tiles + 1] = tile
	end
	sort_hand(hand)
	table.sort(meld_tiles, function(a, b)
		return tile_type(a) < tile_type(b)
	end)
	state.melds[claimant.playerId][#state.melds[claimant.playerId] + 1] = {
		kind = option.kind,
		tiles = meld_tiles,
		fromIndex = discard.playerIndex,
		calledTile = discard.tile,
	}
	state.kuikaeForbidden = state.kuikaeForbidden or {}
	state.kuikaeForbidden[claimant.playerId] = kuikae_forbidden_types(option)
	local discarded = state.discards[state.players[discard.playerIndex]][discard.discardIndex]
	discarded.claimed = true
	if discarded.riichi then
		state.riichiMarkerPending = state.riichiMarkerPending or {}
		state.riichiMarkerPending[discard.player] = true
	end
	state.turnIndex, state.phase, state.lastDiscard, state.drawnTile = claimant.playerIndex, "playing", nil, 0
	events[#events + 1] = {
		type = "claimed",
		kind = option.kind,
		player = claimant.playerId,
		playerIndex = claimant.playerIndex,
		fromIndex = discard.playerIndex,
		tile = discard.tile,
	}
	record_pao(state, claimant.playerId, discard.playerIndex)
	if option.kind == "kan" then
		draw_after_kan(state, claimant.playerIndex, events)
	end
end

local function perform_discard(state, tile_id, actor_id, seat, riichi_declared)
	local hand = state.hands[actor_id]
	local drawn = state.drawnTile or 0
	if state.riichi[actor_id] and not riichi_declared and tile_id ~= drawn then
		return rejected("riichi_tsumogiri_required")
	end
	local forbidden = state.kuikaeForbidden and state.kuikaeForbidden[actor_id] or {}
	if forbidden[tile_type(tile_id)] then
		return rejected("kuikae_forbidden")
	end
	local from_drawn = drawn and drawn > 0 and tile_id == drawn
	local in_hand = false
	for _, tile in ipairs(hand) do
		if tile == tile_id then
			in_hand = true
			break
		end
	end
	if not from_drawn and not in_hand then
		return rejected("tile_not_in_hand")
	end
	local next_count = #hand - (in_hand and 1 or 0) + (not from_drawn and drawn > 0 and 1 or 0)
	if next_count % 3 ~= 1 then
		return rejected("discard_not_allowed")
	end
	if from_drawn then
		state.drawnTile = 0
	else
		remove_tile(hand, tile_id)
		if drawn > 0 then
			hand[#hand + 1] = drawn
		end
		sort_hand(hand)
		state.drawnTile = 0
	end
	state.kuikaeForbidden = state.kuikaeForbidden or {}
	state.kuikaeForbidden[actor_id] = {}
	-- A player's own turn has now completed. This also clears temporary
	-- furiten when that turn began by calling rather than drawing.
	state.tempFuriten[actor_id] = false
	local replace_riichi_marker = state.riichiMarkerPending and state.riichiMarkerPending[actor_id] == true
	state.discards[actor_id][#state.discards[actor_id] + 1] = {
		tile = tile_id,
		claimed = false,
		riichi = riichi_declared == true or replace_riichi_marker,
		tsumogiri = from_drawn,
	}
	if replace_riichi_marker then
		state.riichiMarkerPending[actor_id] = false
	end
	state.firstTurn[actor_id] = false
	if state.riichi[actor_id] and not riichi_declared then
		state.ippatsu[actor_id] = false
	end
	state.moveCount = state.moveCount + 1
	state.rinshanWin = false
	state.lastDiscard = {
		player = actor_id,
		playerIndex = seat,
		tile = tile_id,
		discardIndex = #state.discards[actor_id],
		riichiDeclaration = riichi_declared == true,
	}
	-- Persist each player's final wait set during the final four discards. This
	-- spreads any server fallback work across calls and also survives a room
	-- runtime reload between those calls.
	if #state.wall <= 3 then
		late_wall_waits_for(state, actor_id)
	end
	local events = {
		{
			type = riichi_declared and "riichi" or "discarded",
			player = actor_id,
			playerIndex = seat,
			tile = tile_id,
			fromDrawn = from_drawn,
		},
	}
	if not begin_claims(state, seat, tile_id) then
		advance_after_discard(state, seat, events)
	end
	return accepted(state, events)
end

local function tenpai_discard_waits(state, player_id)
	local hand, result = hand_with_drawn(state, player_id), {}
	for index, tile in ipairs(hand) do
		local candidate = copy_array(hand)
		table.remove(candidate, index)
		local waits = waiting_types(candidate, state.melds[player_id])
		if #waits > 0 then
			result[#result + 1] = { tileId = tile, waits = waits }
		end
	end
	return result
end

local function riichi_discards(state, player_id, discard_waits)
	if
		state.riichi[player_id]
		or not is_closed_hand(state.melds[player_id])
		or state.scores[player_index(state, player_id)] < 1000
		or #state.wall < 4
	then
		return {}
	end
	local result = {}
	for _, entry in ipairs(discard_waits or tenpai_discard_waits(state, player_id)) do
		result[#result + 1] = entry.tileId
	end
	return result
end

local function visible_tile_type_counts(state, player_id)
	local visible_ids, counts = {}, {}
	local function add(tile)
		tile = tonumber(tile) or 0
		if tile > 0 then
			visible_ids[tile] = true
		end
	end
	for _, tile in ipairs(state.hands[player_id] or {}) do
		add(tile)
	end
	if state.players[state.turnIndex] == player_id then
		add(state.drawnTile)
	end
	for _, other_id in ipairs(state.players) do
		for _, discard in ipairs(state.discards[other_id] or {}) do
			add(discard.tile)
		end
		for _, meld in ipairs(state.melds[other_id] or {}) do
			for _, tile in ipairs(meld.tiles or {}) do
				add(tile)
			end
		end
	end
	for index = 1, state.kanCount + 1 do
		add(state.deadWall[(index - 1) * 2 + 1])
	end
	for tile in pairs(visible_ids) do
		local kind = tile_type(tile)
		counts[kind] = (counts[kind] or 0) + 1
	end
	return counts
end

local function tenpai_discard_options(state, player_id, discard_waits, forbidden)
	local seat = player_index(state, player_id)
	local hand = hand_with_drawn(state, player_id)
	local melds = state.melds[player_id]
	local visible, result = visible_tile_type_counts(state, player_id), {}
	for _, entry in ipairs(discard_waits or tenpai_discard_waits(state, player_id)) do
		local tile_id = entry.tileId
		local allowed = not (forbidden and forbidden[tile_type(tile_id)])
			and (not state.riichi[player_id] or tile_id == state.drawnTile)
		if allowed then
			local candidate_hand = copy_array(hand)
			remove_tile(candidate_hand, tile_id)
			local waits = {}
			for _, kind in ipairs(entry.waits) do
				local has_riichi_yaku = state.riichi[player_id] == true
				waits[#waits + 1] = {
					type = kind,
					remaining = math.max(0, 4 - (visible[kind] or 0)),
					noYaku = not has_riichi_yaku and score_hand(
						state,
						seat,
						(kind - 1) * 4 + 1,
						"ron",
						candidate_hand,
						melds
					) == nil,
				}
			end
			local profile = tenpai_wait_profile(
				state,
				seat,
				candidate_hand,
				melds,
				visible,
				tile_type(tile_id)
			)
			result[#result + 1] = {
				tileId = tile_id,
				waits = waits,
				furiten = profile.furiten,
			}
		end
	end
	return result
end

local function apply_riichi(state, action, actor_id, seat)
	if state.phase ~= "playing" or seat ~= state.turnIndex then
		return rejected("not_your_turn")
	end
	-- Calculate the final riichi waits once. The result is both the legality
	-- check and the cache entry used by later furiten checks.
	local candidate = hand_with_drawn(state, actor_id)
	if
		state.riichi[actor_id]
		or not is_closed_hand(state.melds[actor_id])
		or state.scores[seat] < 1000
		or #state.wall < 4
		or not remove_tile(candidate, action.tileId)
	then
		return rejected("riichi_not_allowed")
	end
	candidate = waiting_types(candidate, state.melds[actor_id])
	if #candidate == 0 then
		return rejected("riichi_not_allowed")
	end
	state.scores[seat], state.riichiSticks = state.scores[seat] - 1000, state.riichiSticks + 1
	state.riichi[actor_id], state.ippatsu[actor_id] = true, true
	state.doubleRiichi[actor_id] = state.firstTurn[actor_id] and not state.callOccurred
	local result = perform_discard(state, action.tileId, actor_id, seat, true)
	if not result.accepted then
		state.scores[seat], state.riichiSticks = state.scores[seat] + 1000, math.max(0, state.riichiSticks - 1)
		state.riichi[actor_id], state.doubleRiichi[actor_id], state.ippatsu[actor_id] = false, false, false
	else
		state.riichiWaits = state.riichiWaits or {}
		state.riichiWaits[actor_id] = candidate
	end
	return result
end

local function apply_discard(state, action, actor_id, seat)
	if state.phase ~= "playing" then
		return rejected("claim_response_required")
	end
	if seat ~= state.turnIndex then
		return rejected("not_your_turn")
	end
	if action.type ~= "discard" or type(action.tileId) ~= "number" then
		return rejected("invalid_discard")
	end
	return perform_discard(state, action.tileId, actor_id, seat, false)
end

local function apply_claim_response(state, action, actor_id)
	if state.phase ~= "claiming" then
		return rejected("not_claiming")
	end
	local claimant_index, claimant = pending_claimant_for_player(state, actor_id)
	if not claimant then
		return rejected("not_your_response")
	end
	local option = 0
	if action.type == "claim" then
		option = tonumber(action.option) or 0
		if option % 1 ~= 0 or option < 1 or option > #claimant.options then
			return rejected("invalid_claim")
		end
	elseif action.type ~= "pass" then
		return rejected("claim_response_required")
	end
	local selected = option > 0 and claimant.options[option] or nil
	local declined_ron = claimant.ronOpportunity == true
		and state.autoPassClaimsApplying ~= actor_id
		and (not selected or selected.kind ~= "ron")
	if declined_ron then
		if state.riichi[actor_id] then
			state.riichiFuriten[actor_id] = true
		else
			state.tempFuriten[actor_id] = true
		end
	end
	state.claimResponses[#state.claimResponses + 1] = { claimant = claimant_index, option = option }
	local events = {
		{
			type = option == 0 and "claim_passed" or "claim_declared",
			player = actor_id,
			playerIndex = claimant.playerIndex,
		},
	}
	cancel_lower_priority_claims(state, highest_selected_claim_priority(state))
	if refresh_claim_index(state) == 0 then
		resolve_claims(state, events)
	end
	return accepted(state, events)
end

local function apply_tsumo(state, actor_id, seat)
	if state.phase ~= "playing" or state.turnIndex ~= seat then
		return rejected("not_your_turn")
	end
	if state.drawnTile == 0 then
		return rejected("draw_required")
	end
	if not settle_win(state, seat, "tsumo", 0, state.drawnTile) then
		return rejected("no_yaku")
	end
	return accepted(
		state,
		{ { type = "won", method = "tsumo", player = actor_id, playerIndex = seat, tile = state.winningTile } }
	)
end

local function can_abort_nine(state, player_id)
	if
		not state.rules.abortiveDraws
		or state.callOccurred
		or not state.firstTurn[player_id]
		or state.drawnTile == 0
	then
		return false
	end
	local distinct = {}
	for _, tile in ipairs(hand_with_drawn(state, player_id)) do
		local kind = tile_type(tile)
		if is_outside(kind) then
			distinct[kind] = true
		end
	end
	local count = 0
	for _ in pairs(distinct) do
		count = count + 1
	end
	return count >= 9
end

local function apply_abort_nine(state, actor_id, seat)
	if state.phase ~= "playing" or state.turnIndex ~= seat or not can_abort_nine(state, actor_id) then
		return rejected("nine_terminals_not_allowed")
	end
	finish_abortive_draw(state, "九种九牌", seat)
	return accepted(
		state,
		{ { type = "abortive_draw", reason = "九种九牌", player = actor_id, playerIndex = seat } }
	)
end

local function visible_melds(state)
	local result = {}
	for _, player_id in ipairs(state.players) do
		result[player_id] = {}
		for _, meld in ipairs(state.melds[player_id]) do
			local tiles, red = {}, {}
			local called_tile_index, added_tile_index = -1, -1
			for index, tile in ipairs(meld.tiles) do
				tiles[#tiles + 1], red[#red + 1] = tile_type(tile), RED_FIVES[tile] == true
				if tile == meld.calledTile then
					called_tile_index = index - 1
				end
				if tile == meld.addedTile then
					added_tile_index = index - 1
				end
			end
			result[player_id][#result[player_id] + 1] = {
				kind = meld.kind,
				tiles = tiles,
				red = red,
				fromIndex = meld.fromIndex,
				calledTileIndex = called_tile_index,
				addedTileIndex = added_tile_index,
			}
		end
	end
	return result
end

local function visible_discards(state)
	local result = {}
	for _, player_id in ipairs(state.players) do
		result[player_id] = {}
		for _, discard in ipairs(state.discards[player_id]) do
			result[player_id][#result[player_id] + 1] = {
				type = tile_type(discard.tile),
				red = RED_FIVES[discard.tile] == true,
				claimed = discard.claimed == true,
				riichi = discard.riichi == true,
				tsumogiri = discard.tsumogiri == true,
			}
		end
	end
	return result
end

local function visible_events(events, viewer_id)
	local result = {}
	for _, event in ipairs(events or {}) do
		-- Responses are private while the call window remains open.  The final
		-- resolved "claimed" or "won" event is public, so these interim events
		-- are redundant once the window closes as well.
		if event.type ~= "claim_passed" and event.type ~= "claim_declared" then
			local copy = {}
			for key, value in pairs(event) do
				if key ~= "tile" or event.type ~= "drew" or event.player == viewer_id then
					copy[key] = key == "tile" and tile_type(value) or value
				end
			end
			result[#result + 1] = copy
		end
	end
	return result
end

local function legal_actions(state, viewer_id, fast_projection)
	local seat = player_index(state, viewer_id)
	local legal = {
		canDiscard = false,
		canTsumo = false,
		canRiichi = false,
		canAbortNine = false,
		riichiTiles = {},
		selfKans = {},
		claims = {},
		tenpaiDiscards = {},
		forbiddenDiscardTypes = {},
	}
	if not seat or state.phase == "hand_ended" then
		return legal
	end
	if state.phase == "playing" and state.turnIndex == seat then
		legal.canDiscard = true
		for kind, is_forbidden in pairs(state.kuikaeForbidden and state.kuikaeForbidden[viewer_id] or {}) do
			if is_forbidden then
				legal.forbiddenDiscardTypes[#legal.forbiddenDiscardTypes + 1] = kind
			end
		end
		table.sort(legal.forbiddenDiscardTypes)
		-- The room service has a strict per-call instruction quota.  Exact
		-- tenpai, riichi, yaku, and furiten previews belong to the local Lua
		-- worker; action validation below remains authoritative.
		if fast_projection then
			return legal
		end
		local discard_waits = tenpai_discard_waits(state, viewer_id)
		legal.canTsumo = state.drawnTile > 0 and score_hand(state, seat, state.drawnTile, "tsumo") ~= nil
		legal.riichiTiles = riichi_discards(state, viewer_id, discard_waits)
		legal.tenpaiDiscards = tenpai_discard_options(
			state,
			viewer_id,
			discard_waits,
			state.kuikaeForbidden and state.kuikaeForbidden[viewer_id] or nil
		)
		legal.canRiichi = #legal.riichiTiles > 0
		legal.canAbortNine = can_abort_nine(state, viewer_id)
		legal.selfKans = self_kan_options(state, viewer_id)
	elseif state.phase == "claiming" then
		local _, claimant = pending_claimant_for_player(state, viewer_id)
		if claimant then
			for index, option in ipairs(claimant.options) do
				local types, red = {}, {}
				for _, tile in ipairs(option.tileIds) do
					types[#types + 1], red[#red + 1] = tile_type(tile), RED_FIVES[tile] == true
				end
				legal.claims[#legal.claims + 1] = {
					option = index,
					kind = option.kind,
					tileTypes = types,
					red = red,
				}
			end
		end
	end
	return legal
end

-- `standard_shanten` is the hottest part of the local AI: every candidate
-- discard and every possible improving draw reaches it.  It mutates and fully
-- restores its input, so accept a count vector directly and avoid rebuilding
-- that vector from the hand for each probe.
local function standard_shanten_counts(counts, meld_count)
	local best = 8
	local function search(kind, groups, pair, shapes)
		while kind <= 34 and counts[kind] == 0 do
			kind = kind + 1
		end
		if kind > 34 then
			local usable_shapes = math.min(shapes, math.max(0, 4 - groups))
			best = math.min(best, 8 - groups * 2 - usable_shapes - pair)
			return
		end
		if counts[kind] >= 3 then
			counts[kind] = counts[kind] - 3
			search(kind, groups + 1, pair, shapes)
			counts[kind] = counts[kind] + 3
		end
		local rank = kind <= 27 and (((kind - 1) % 9) + 1) or 0
		if rank > 0 and rank <= 7 and counts[kind + 1] > 0 and counts[kind + 2] > 0 then
			counts[kind], counts[kind + 1], counts[kind + 2] =
				counts[kind] - 1, counts[kind + 1] - 1, counts[kind + 2] - 1
			search(kind, groups + 1, pair, shapes)
			counts[kind], counts[kind + 1], counts[kind + 2] =
				counts[kind] + 1, counts[kind + 1] + 1, counts[kind + 2] + 1
		end
		if pair == 0 and counts[kind] >= 2 then
			counts[kind] = counts[kind] - 2
			search(kind, groups, 1, shapes)
			counts[kind] = counts[kind] + 2
		end
		if counts[kind] >= 2 then
			counts[kind] = counts[kind] - 2
			search(kind, groups, pair, shapes + 1)
			counts[kind] = counts[kind] + 2
		end
		if rank > 0 and rank <= 8 and counts[kind + 1] > 0 then
			counts[kind], counts[kind + 1] = counts[kind] - 1, counts[kind + 1] - 1
			search(kind, groups, pair, shapes + 1)
			counts[kind], counts[kind + 1] = counts[kind] + 1, counts[kind + 1] + 1
		end
		if rank > 0 and rank <= 7 and counts[kind + 2] > 0 then
			counts[kind], counts[kind + 2] = counts[kind] - 1, counts[kind + 2] - 1
			search(kind, groups, pair, shapes + 1)
			counts[kind], counts[kind + 2] = counts[kind] + 1, counts[kind + 2] + 1
		end
		counts[kind] = counts[kind] - 1
		search(kind, groups, pair, shapes)
		counts[kind] = counts[kind] + 1
	end
	search(1, meld_count or 0, 0, 0)
	return best
end

local function shanten_cache_key(counts, meld_count)
	-- Each count fits in one byte. This replaces a 35-item tostring/table.concat
	-- allocation on every shanten probe with one compact, collision-free key.
	local bytes = { string.char(meld_count or 0) }
	for kind = 1, 34 do
		bytes[#bytes + 1] = string.char(counts[kind] or 0)
	end
	return table.concat(bytes)
end

local function hand_shanten_counts(counts, meld_count, cache)
	local key = shanten_cache_key(counts, meld_count)
	if cache and cache[key] ~= nil then
		return cache[key]
	end
	local best = standard_shanten_counts(counts, meld_count)
	if meld_count == 0 then
		local pairs, distinct = 0, 0
		for kind = 1, 34 do
			if counts[kind] > 0 then
				distinct = distinct + 1
			end
			if counts[kind] >= 2 then
				pairs = pairs + 1
			end
		end
		best = math.min(best, 6 - pairs + math.max(0, 7 - distinct))
		local unique, outside_pair = 0, false
		for _, kind in ipairs({ 1, 9, 10, 18, 19, 27, 28, 29, 30, 31, 32, 33, 34 }) do
			if counts[kind] > 0 then
				unique = unique + 1
			end
			if counts[kind] >= 2 then
				outside_pair = true
			end
		end
		best = math.min(best, 13 - unique - (outside_pair and 1 or 0))
	end
	if cache then
		cache[key] = best
	end
	return best
end

local function hand_shanten(hand, melds, cache)
	local counts = type_counts(hand)
	return hand_shanten_counts(counts, #(melds or {}), cache)
end

local function special_hand_profile(hand, melds)
	if #(melds or {}) ~= 0 then
		return { chiitoi = 8, kokushi = 14, pairs = 0 }
	end
	local counts, pairs, distinct = type_counts(hand), 0, 0
	for kind = 1, 34 do
		if counts[kind] > 0 then
			distinct = distinct + 1
		end
		if counts[kind] >= 2 then
			pairs = pairs + 1
		end
	end
	local chiitoi = 6 - pairs + math.max(0, 7 - distinct)
	local unique, outside_pair = 0, false
	for _, kind in ipairs({ 1, 9, 10, 18, 19, 27, 28, 29, 30, 31, 32, 33, 34 }) do
		if counts[kind] > 0 then
			unique = unique + 1
		end
		if counts[kind] >= 2 then
			outside_pair = true
		end
	end
	return {
		chiitoi = chiitoi,
		kokushi = 13 - unique - (outside_pair and 1 or 0),
		pairs = pairs,
		terminals = unique,
	}
end

-- A fast, decomposition-aware tie breaker for equal-shanten hands.  The old
-- adjacency counter credited one tile for several overlapping blocks (for
-- example 3456 counted both 34, 45, 56 and 35), so it regularly chose a
-- visually busy but less flexible hand.  This search uses each tile once and
-- values completed sets, a head, ryanmen taatsu, then other taatsu under the
-- four-block limit.  It is deliberately much cheaper than a draw-then-best-
-- discard search and is memoized alongside the shanten probes.
local function block_shape_value(hand, melds, cache)
	local counts, meld_count = type_counts(hand), #(melds or {})
	local key = shanten_cache_key(counts, meld_count)
	if cache and cache[key] ~= nil then
		return cache[key]
	end
	local best = 0
	local function search(kind, groups, pair, ryanmen, other_taatsu)
		while kind <= 34 and counts[kind] == 0 do
			kind = kind + 1
		end
		if kind > 34 then
			local usable = math.min(ryanmen + other_taatsu, math.max(0, 4 - groups))
			local used_ryanmen = math.min(ryanmen, usable)
			local used_other = usable - used_ryanmen
			-- Fixed melds only constrain the remaining block slots; they add no
			-- tie-break score because every compared candidate shares them.
			local score = (groups - meld_count) * 24 + used_ryanmen * 7 + used_other * 5 + pair * 3
			best = math.max(best, score)
			return
		end
		if counts[kind] >= 3 then
			counts[kind] = counts[kind] - 3
			search(kind, groups + 1, pair, ryanmen, other_taatsu)
			counts[kind] = counts[kind] + 3
		end
		local rank = kind <= 27 and ((kind - 1) % 9) + 1 or 0
		if rank > 0 and rank <= 7 and counts[kind + 1] > 0 and counts[kind + 2] > 0 then
			counts[kind], counts[kind + 1], counts[kind + 2] =
				counts[kind] - 1, counts[kind + 1] - 1, counts[kind + 2] - 1
			search(kind, groups + 1, pair, ryanmen, other_taatsu)
			counts[kind], counts[kind + 1], counts[kind + 2] =
				counts[kind] + 1, counts[kind + 1] + 1, counts[kind + 2] + 1
		end
		if pair == 0 and counts[kind] >= 2 then
			counts[kind] = counts[kind] - 2
			search(kind, groups, 1, ryanmen, other_taatsu)
			counts[kind] = counts[kind] + 2
		end
		if counts[kind] >= 2 then
			counts[kind] = counts[kind] - 2
			search(kind, groups, pair, ryanmen, other_taatsu + 1)
			counts[kind] = counts[kind] + 2
		end
		if rank > 0 and rank <= 8 and counts[kind + 1] > 0 then
			counts[kind], counts[kind + 1] = counts[kind] - 1, counts[kind + 1] - 1
			if rank >= 2 and rank <= 7 then
				search(kind, groups, pair, ryanmen + 1, other_taatsu)
			else
				search(kind, groups, pair, ryanmen, other_taatsu + 1)
			end
			counts[kind], counts[kind + 1] = counts[kind] + 1, counts[kind + 1] + 1
		end
		if rank > 0 and rank <= 7 and counts[kind + 2] > 0 then
			counts[kind], counts[kind + 2] = counts[kind] - 1, counts[kind + 2] - 1
			search(kind, groups, pair, ryanmen, other_taatsu + 1)
			counts[kind], counts[kind + 2] = counts[kind] + 1, counts[kind + 2] + 1
		end
		counts[kind] = counts[kind] - 1
		search(kind, groups, pair, ryanmen, other_taatsu)
		counts[kind] = counts[kind] + 1
	end
	search(1, meld_count, 0, 0, 0)
	if cache then
		cache[key] = best
	end
	return best
end

-- A decomposition chooses disjoint blocks, so it deliberately regards 456 and
-- 4556 as one completed block.  For an otherwise tied discard this loses a
-- real tile-efficiency distinction: the repeated middle tile (and longer
-- consecutive runs) keeps alternative two-block continuations after the next
-- draw.  Count those overlapping *three-tile cores* only as a lexicographic
-- tie-break below; using this globally would double-count the same tiles.
local function sequence_core_value(hand)
	local counts, total = type_counts(hand), 0
	for suit = 0, 2 do
		local first = suit * 9 + 1
		for rank = 1, 7 do
			local kind = first + rank - 1
			if counts[kind] > 0 and counts[kind + 1] > 0 and counts[kind + 2] > 0 then
				total = total + 1
				-- A duplicate in the middle supports two adjacent runs (4556,
				-- 3445, etc.); an end duplicate does not create that same fork.
				if counts[kind + 1] >= 2 then
					total = total + 1
				end
			end
		end
	end
	return total
end

-- A pair next to a suited tile (334, 455, etc.) can keep the head while the
-- neighbouring tile develops a sequence.  It is more concrete than a lone
-- yakuhai: the pair is already present.  Like `sequence_core_value`, this is
-- only a strict tie-break and never contributes a global shape weight.
local function pair_extension_value(hand)
	local counts, total = type_counts(hand), 0
	for suit = 0, 2 do
		local first = suit * 9 + 1
		for rank = 1, 9 do
			local kind = first + rank - 1
			if counts[kind] >= 2 then
				if rank > 1 and counts[kind - 1] > 0 then
					total = total + 1
				end
				if rank < 9 and counts[kind + 1] > 0 then
					total = total + 1
				end
			end
		end
	end
	return total
end

local function visible_type_counts(state, player_id, own_hand, own_melds)
	local counts, seen = {}, {}
	for kind = 1, 34 do
		counts[kind] = 0
	end
	local function add(tile)
		if tile and tile > 0 and not seen[tile] then
			seen[tile] = true
			local kind = tile_type(tile)
			counts[kind] = counts[kind] + 1
		end
	end
	for _, tile in ipairs(own_hand or state.hands[player_id] or {}) do
		add(tile)
	end
	for _, id in ipairs(state.players) do
		local melds = id == player_id and own_melds or state.melds[id]
		for _, meld in ipairs(melds or {}) do
			for _, tile in ipairs(meld.tiles or {}) do
				add(tile)
			end
		end
		for _, discard in ipairs(state.discards[id] or {}) do
			add(discard.tile)
		end
	end
	for index = 1, state.kanCount + 1 do
		add(state.deadWall[(index - 1) * 2 + 1])
	end
	return counts
end

local function is_dora_kind(state, kind)
	for _, indicator in ipairs(indicator_types(state, false)) do
		if next_dora(indicator) == kind then
			return true
		end
	end
	return false
end

local function value_honor_kind(state, seat, kind)
	if kind >= 32 then
		return true
	end
	local seat_wind = 28 + ((seat - state.dealerIndex + 4) % 4)
	local round_wind = 27 + state.roundWind
	return kind == seat_wind or kind == round_wind
end

-- This is deliberately a small, directional estimate rather than a scoring
-- routine.  Dora and completed yaku are made value; an unfinished flush or
-- yakuhai pair is only worth its chance of still being completed.  Keeping
-- that distinction here stops the discard AI from treating a pretty-looking
-- one-suit hand as though it had already made three to six han.
local function route_reachability(shanten, melds)
	local stage = shanten <= 0 and 0.90 or shanten == 1 and 0.64 or shanten == 2 and 0.34 or 0.14
	-- An open meld is tangible progress toward an open route.  A closed hand
	-- still has more options, but has not committed its speed to that route.
	if #(melds or {}) == 0 then
		stage = stage * 0.90
	end
	return stage
end

local function estimated_hand_value(state, seat, hand, melds, shanten)
	local counts = type_counts(hand)
	local ids = all_tile_ids(hand, melds)
	local dora = count_dora(state, hand, melds, false)
	local closed = is_closed_hand(melds)
	if shanten == nil then
		shanten = hand_shanten(hand, melds, {})
	end
	local value, natural, potential = dora, 0, 0
	-- Menzen is an option value (riichi / closed-only yaku), not a made han.
	if closed then
		potential = potential + 0.75 * route_reachability(shanten, melds)
	end
	local all_simple, suits, has_honor = true, {}, false
	for _, tile in ipairs(ids) do
		local kind = tile_type(tile)
		if is_outside(kind) then
			all_simple = false
		end
		if is_honor(kind) then
			has_honor = true
		else
			suits[math.floor((kind - 1) / 9)] = true
		end
	end
	if all_simple and #ids > 0 then
		-- Tanyao-compatible shape is valuable, but like a flush it is a route
		-- until the final winning hand is fixed.  `natural` remains a yaku-route
		-- flag for riichi/open-hand decisions; only the numeric estimate is
		-- discounted by reachability.
		potential, natural = potential + route_reachability(shanten, melds), natural + 1
	end
	for kind = 28, 34 do
		local completed = counts[kind] >= 3
		for _, meld in ipairs(melds or {}) do
			if meld.kind ~= "chi" and tile_type(meld.tiles[1]) == kind then
				completed = true
			end
		end
		if completed and value_honor_kind(state, seat, kind) then
			local amount = kind <= 31
					and kind == 28 + ((seat - state.dealerIndex + 4) % 4)
					and kind == 27 + state.roundWind
					and 2
				or 1
			value, natural = value + amount, natural + amount
		elseif counts[kind] == 2 and value_honor_kind(state, seat, kind) then
			potential = potential + 0.35 * route_reachability(shanten, melds)
		end
	end
	local suit_count = 0
	for _ in pairs(suits) do
		suit_count = suit_count + 1
	end
	if suit_count == 1 and #ids >= 10 then
		local amount = has_honor and (closed and 3 or 2) or (closed and 6 or 5)
		-- Flush is not a yaku until the hand wins.  It remains a useful target,
		-- but only its reachable share belongs in a discard comparison.
		potential = potential + amount * route_reachability(shanten, melds)
	end
	return value + potential, natural, { made = value, potential = potential }
end

local function open_yaku_available(state, seat, hand, melds)
	local _, natural = estimated_hand_value(state, seat, hand, melds)
	if natural >= 1 then
		return true
	end
	local counts, pairs_or_sets, has_sequence = type_counts(hand), 0, false
	for kind = 1, 34 do
		if counts[kind] >= 2 then
			pairs_or_sets = pairs_or_sets + 1
		end
	end
	for _, meld in ipairs(melds or {}) do
		if meld.kind == "chi" then
			has_sequence = true
		else
			pairs_or_sets = pairs_or_sets + 1
		end
	end
	return not has_sequence and pairs_or_sets >= 4
end

local function ai_hand_goal(state, seat, hand, melds)
	local counts = type_counts(hand)
	local value, natural = estimated_hand_value(state, seat, hand, melds)
	local suit_counts, honors, simples = { 0, 0, 0 }, 0, true
	local pairs_or_sets, sequence_melds = 0, 0
	for kind = 1, 34 do
		if counts[kind] >= 2 then
			pairs_or_sets = pairs_or_sets + 1
		end
		if counts[kind] > 0 and is_outside(kind) then
			simples = false
		end
		if kind <= 27 then
			suit_counts[math.floor((kind - 1) / 9) + 1] = suit_counts[math.floor((kind - 1) / 9) + 1] + counts[kind]
		else
			honors = honors + counts[kind]
		end
	end
	for _, meld in ipairs(melds or {}) do
		if meld.kind == "chi" then
			sequence_melds = sequence_melds + 1
		else
			pairs_or_sets = pairs_or_sets + 1
		end
		for _, tile in ipairs(meld.tiles or {}) do
			local kind = tile_type(tile)
			if is_outside(kind) then
				simples = false
			end
			if kind <= 27 then
				suit_counts[math.floor((kind - 1) / 9) + 1] = suit_counts[math.floor((kind - 1) / 9) + 1] + 1
			else
				honors = honors + 1
			end
		end
	end
	local dominant, other_suits = 0, 0
	for suit = 1, 3 do
		dominant = math.max(dominant, suit_counts[suit])
	end
	for suit = 1, 3 do
		if suit_counts[suit] > 0 and suit_counts[suit] < dominant then
			other_suits = other_suits + 1
		end
	end
	local route, open_value, guaranteed_open = "closed", natural, 0
	for kind = 28, 34 do
		for _, meld in ipairs(melds or {}) do
			if meld.kind ~= "chi" and tile_type(meld.tiles[1]) == kind and value_honor_kind(state, seat, kind) then
				guaranteed_open = math.max(
					guaranteed_open,
					kind <= 31
							and kind == 28 + ((seat - state.dealerIndex + 4) % 4)
							and kind == 27 + state.roundWind
							and 2
						or 1
				)
			end
		end
	end
	if dominant >= 8 and other_suits == 0 then
		route, open_value = honors > 0 and "honitsu" or "chinitsu", honors > 0 and 2 or 5
	elseif sequence_melds == 0 and pairs_or_sets >= 4 then
		route, open_value = "toitoi", math.max(open_value, 2)
	elseif simples then
		route, open_value = "tanyao", math.max(open_value, 1)
	else
		for kind = 28, 34 do
			if counts[kind] >= 2 and value_honor_kind(state, seat, kind) then
				route, open_value = "yakuhai", math.max(open_value, 1)
			end
		end
	end
	return {
		route = route,
		openValue = open_value,
		-- A shape that currently looks like tanyao/honitsu/toitoi is not a yaku
		-- after a call yet: later draws and the final pair can still invalidate
		-- it.  Only a completed value-honor meld is truly guaranteed here.
		guaranteedOpen = guaranteed_open,
		closedValue = value,
		preserveClosed = route == "closed" and guaranteed_open < 1,
	}
end

local function opponent_discarded_types(state, player_id)
	local result = {}
	for _, discard in ipairs(state.discards[player_id] or {}) do
		result[tile_type(discard.tile)] = true
	end
	return result
end

local function logistic(value, midpoint, steepness)
	return 1 / (1 + math.exp(-steepness * (value - midpoint)))
end

local function early_outer_factor(state, opponent_id, kind)
	if kind > 27 then
		return 1
	end
	local rank = ((kind - 1) % 9) + 1
	if rank > 3 and rank < 7 then
		return 1
	end
	local suit_start = math.floor((kind - 1) / 9) * 9 + 1
	local factor = 1
	local discards = state.discards[opponent_id] or {}
	local riichi_index = nil
	if state.riichi[opponent_id] then
		for index, discard in ipairs(discards) do
			if discard.riichi then
				riichi_index = index
				break
			end
		end
	end
	-- Sotogawa is evidence, not genbutsu.  Use one S-curve over the effective
	-- earliness rather than multiplying separate "early discard" and "time
	-- before riichi" curves: those inputs overlap and would double-discount a
	-- tile that was discarded very early before a late riichi.
	--
	-- The gap before riichi carries almost all of the signal.  A small late-hand
	-- adjustment only lets a long river settle the confidence sooner.  For a
	-- sixth-turn riichi, gaps 1..5 are about 8%, 27%, 61%, 87%, and 97%; by a
	-- twelfth-turn riichi, every source in the first six discards is near the
	-- curve's ceiling.  This confidence merely enables the bounded early-outer
	-- discount below; it never makes the tile equivalent to genbutsu.
	local observation_index = riichi_index or #discards
	local source_limit = riichi_index and riichi_index - 1 or #discards
	for index, discard in ipairs(discards) do
		if index > source_limit then
			break
		end
		local discarded = tile_type(discard.tile)
		if discarded >= suit_start and discarded < suit_start + 9 then
			local discarded_rank = ((discarded - 1) % 9) + 1
			local distance = math.abs(discarded_rank - rank)
			local points_outward = (rank <= 3 and discarded_rank > rank) or (rank >= 7 and discarded_rank < rank)
			if points_outward and distance >= 3 and distance <= 5 then
				local pattern_strength = distance == 3 and 0.42 or distance == 4 and 0.29 or 0.17
				local age_before_observation = math.max(0, observation_index - index)
				local late_hand_adjustment = math.max(0, observation_index - 8) * 0.04
				local effective_earliness = age_before_observation + late_hand_adjustment
				local confidence = logistic(effective_earliness, 2.70, 1.45)
				if not riichi_index then
					confidence = confidence * 0.55
				end
				factor = math.min(factor, 1 - pattern_strength * confidence)
			end
		end
	end
	return factor
end

local function wall_factor(kind, visible_counts)
	if (visible_counts[kind] or 0) >= 4 then
		return 0
	end
	if kind > 27 then
		local visible = visible_counts[kind] or 0
		return visible >= 3 and 0.55 or visible == 2 and 0.76 or 1
	end
	local suit_start = math.floor((kind - 1) / 9) * 9 + 1
	local rank = ((kind - 1) % 9) + 1
	local patterns, blocked, one_chance = 0, 0, 0
	for start = math.max(1, rank - 2), math.min(7, rank) do
		patterns = patterns + 1
		local first, second = suit_start + start - 1, suit_start + start
		if rank == start then
			first, second = kind + 1, kind + 2
		elseif rank == start + 1 then
			first, second = kind - 1, kind + 1
		else
			first, second = kind - 2, kind - 1
		end
		local first_visible, second_visible = visible_counts[first] or 0, visible_counts[second] or 0
		if first_visible >= 4 or second_visible >= 4 then
			blocked = blocked + 1
		elseif first_visible >= 3 or second_visible >= 3 then
			one_chance = one_chance + 1
		end
	end
	if patterns == 0 then
		return 1
	end
	return math.max(0.38, 1 - blocked / patterns * 0.54 - one_chance / patterns * 0.12)
end

local function opponent_suit_factor(state, opponent_id, kind)
	if kind > 27 then
		return 1
	end
	local melds = state.melds[opponent_id] or {}
	if #melds < 2 then
		return 1
	end
	local suits = { 0, 0, 0 }
	for _, meld in ipairs(melds) do
		for _, tile in ipairs(meld.tiles or {}) do
			local meld_kind = tile_type(tile)
			if meld_kind <= 27 then
				suits[math.floor((meld_kind - 1) / 9) + 1] = suits[math.floor((meld_kind - 1) / 9) + 1] + 1
			end
		end
	end
	local focus, focused_count = 0, 0
	for suit = 1, 3 do
		if suits[suit] > focused_count then
			focus, focused_count = suit, suits[suit]
		end
	end
	if focused_count < 5 then
		return 1
	end
	local candidate_suit = math.floor((kind - 1) / 9) + 1
	if candidate_suit == focus then
		return 1.18 + math.min(0.18, (focused_count - 5) * 0.04)
	end
	return 0.82
end

local function opponent_profile(state, opponent_id)
	local melds, discards = state.melds[opponent_id] or {}, state.discards[opponent_id] or {}
	local profile = { speed = 0, value = 0, flushSuit = 0, flush = 0, lateHandCut = 0, riichiTurn = 0 }
	local suits, value_melds, dora_melds = { 0, 0, 0 }, 0, 0
	for _, meld in ipairs(melds) do
		for _, tile in ipairs(meld.tiles or {}) do
			local kind = tile_type(tile)
			if kind <= 27 then
				suits[math.floor((kind - 1) / 9) + 1] = suits[math.floor((kind - 1) / 9) + 1] + 1
			end
		end
		local kind = tile_type(meld.tiles[1])
		if meld.kind ~= "chi" and value_honor_kind(state, player_index(state, opponent_id), kind) then
			value_melds = value_melds + 1
		end
		if is_dora_kind(state, kind) then
			dora_melds = dora_melds + 1
		end
	end
	for suit = 1, 3 do
		if suits[suit] >= 5 and suits[suit] > profile.flush then
			profile.flushSuit, profile.flush = suit, suits[suit]
		end
	end
	for index, discard in ipairs(discards) do
		if discard.riichi then
			profile.riichiTurn = index
		end
		-- A hand-cut after the middle game carries more shape information than a
		-- tsumogiri.  Consecutive tsumogiri after calls instead indicates that an
		-- open hand has stabilised and is more likely to be close to completion.
		if index >= 7 and discard.tsumogiri == false then
			profile.lateHandCut = profile.lateHandCut + 1
		end
	end
	local consecutive_tsumogiri = 0
	for index = #discards, 1, -1 do
		if discards[index].tsumogiri then
			consecutive_tsumogiri = consecutive_tsumogiri + 1
		else
			break
		end
	end
	if state.riichi[opponent_id] then
		profile.speed = 0.94 + (profile.riichiTurn > 0 and math.min(0.14, profile.riichiTurn * 0.012) or 0)
		profile.value = 1.25 + math.min(0.32, math.max(0, profile.riichiTurn - 7) * 0.035)
	else
		profile.speed = #melds == 1 and 0.18 or #melds == 2 and 0.42 or #melds >= 3 and 0.70 or 0
		profile.speed = profile.speed + math.min(0.16, consecutive_tsumogiri * 0.04)
		profile.value = value_melds * 0.52 + dora_melds * 0.28
		if profile.flush >= 5 then
			profile.value = profile.value + 0.45 + math.min(0.24, (profile.flush - 5) * 0.08)
		end
	end
	profile.value = profile.value + math.min(0.10, profile.lateHandCut * 0.025)
	return profile
end

local function opponent_dealin_loss(state, opponent_id)
	local seat = player_index(state, opponent_id)
	local profile = opponent_profile(state, opponent_id)
	local base = state.riichi[opponent_id] and 5200 or 2300 + #(state.melds[opponent_id] or {}) * 600
	base = base * (1 + profile.value * 0.34)
	if seat == state.dealerIndex then
		base = base * 1.45
	end
	return base
end

local function opponent_threat_strength(state, player_id)
	local profile = opponent_profile(state, player_id)
	return profile.speed + profile.value * 0.16
end

local function ai_threat_pressure(state, seat)
	local total = 0
	for other = 1, PLAYER_COUNT do
		if other ~= seat then
			total = total + opponent_threat_strength(state, state.players[other])
		end
	end
	return total
end

local function tile_danger_against(state, opponent_id, kind, visible_counts)
	local threat = opponent_threat_strength(state, opponent_id)
	if threat <= 0 then
		return 0
	end
	local discarded = opponent_discarded_types(state, opponent_id)
	if discarded[kind] then
		return 0
	end
	local danger
	if is_honor(kind) then
		local visible = visible_counts[kind] or 0
		danger = visible >= 3 and 0.02 or visible == 2 and 0.16 or visible == 1 and 0.38 or 0.62
	else
		local rank = ((kind - 1) % 9) + 1
		local base = ({ 0.30, 0.52, 0.68, 0.84, 0.94, 0.84, 0.68, 0.52, 0.30 })[rank]
		local suji, possible = 0, 0
		if rank >= 4 then
			possible = possible + 1
			if discarded[kind - 3] then
				suji = suji + 1
			end
		end
		if rank <= 6 then
			possible = possible + 1
			if discarded[kind + 3] then
				suji = suji + 1
			end
		end
		local suji_factor = 1 - (possible > 0 and suji / possible or 0) * 0.56
		if suji == 2 then
			suji_factor = math.min(suji_factor, 0.40)
		end
		local baseline = base * suji_factor
		local wall = wall_factor(kind, visible_counts)
		local early = early_outer_factor(state, opponent_id, kind)
		local suit = opponent_suit_factor(state, opponent_id, kind)
		-- Wall and early-outer are correlated "shape is less likely" clues.  A
		-- straight multiplication made two ordinary hints look like proof of
		-- safety.  Retain strong early-outer, but cap their combined discount.
		if suit > 1 then
			early = 1 - (1 - early) * 0.58
		end
		if is_dora_kind(state, kind) then
			early = 1 - (1 - early) * 0.48
		end
		danger = baseline * math.max(0.48, wall * early) * suit
		if is_dora_kind(state, kind) then
			-- Dora still benefits from real suji/wall evidence, just never becomes
			-- cheap merely because several soft heuristics coincided.
			danger = math.max(danger, baseline * 0.70) + 0.22
		end
	end
	if is_honor(kind) and is_dora_kind(state, kind) then
		danger = danger + 0.24
	end
	return danger * threat
end

local function tile_danger(state, seat, tile, visible_counts)
	local kind, total = tile_type(tile), 0
	for other = 1, PLAYER_COUNT do
		if other ~= seat then
			total = total + tile_danger_against(state, state.players[other], kind, visible_counts)
		end
	end
	return total
end

local function tile_dealin_risk(state, seat, tile, visible_counts)
	local kind, total = tile_type(tile), 0
	for other = 1, PLAYER_COUNT do
		if other ~= seat then
			local opponent_id = state.players[other]
			local danger = tile_danger_against(state, opponent_id, kind, visible_counts)
			-- `danger` already includes the probability-like threat term.  Scaling
			-- it by expected loss separates a cheap early riichi from a dealer's
			-- value-heavy open hand without a hidden-hand simulation.
			total = total + danger * opponent_dealin_loss(state, opponent_id) / 5200
		end
	end
	return total
end

local function tile_keep_bonus(state, seat, tile, hand_counts, visible_counts, resulting_shanten)
	local kind, bonus = tile_type(tile), 0
	if RED_FIVES[tile] then
		bonus = bonus + 7
	end
	for _, indicator in ipairs(indicator_types(state, false)) do
		if next_dora(indicator) == kind then
			bonus = bonus + 6
		end
	end
	local counts = hand_counts or {}
	if value_honor_kind(state, seat, kind) then
		-- A value-honor pair is a real route, but a lone value honor is only a
		-- speculative route.  The old flat bonus made the AI retain a visibly
		-- depleted singleton while breaking a pair or a useful taatsu.
		if (counts[kind] or 0) >= 2 then
			bonus = bonus + 1.5
		elseif
			(counts[kind] or 0) == 1
			and (resulting_shanten or 8) <= 1
			and 4 - (visible_counts and visible_counts[kind] or 1) >= 2
		then
			bonus = bonus + 0.25
		end
	elseif not is_honor(kind) and (counts[kind] or 0) == 2 then
		-- Preserve a non-honor pair slightly more often when it competes with
		-- an isolated tile.  Shape scoring already sees a head, so this is a
		-- small tie-break rather than a new search or a hard rule.
		bonus = bonus + 0.35
	end
	return bonus
end

-- Keep this separate from `tile_keep_bonus`: it is only consulted when two
-- discards are already near-equal.  That lets a live double-wind or a tile
-- beside dora settle an otherwise arbitrary choice without reviving the old
-- behaviour of breaking a real shape just to retain a speculative yakuhai.
local function tile_close_score_keep_value(state, seat, tile, hand_counts, visible_counts)
	local kind = tile_type(tile)
	if (hand_counts[kind] or 0) ~= 1 then
		return 0
	end
	local value = 0
	if value_honor_kind(state, seat, kind) then
		local remaining = math.max(0, 4 - (visible_counts[kind] or 0))
		local seat_wind = 28 + ((seat - state.dealerIndex + 4) % 4)
		local round_wind = 27 + state.roundWind
		local double_wind = kind == seat_wind and kind == round_wind
		-- One live copy of a normal yakuhai is not a route.  A fully live
		-- double wind is materially better, but still only a close-score tie
		-- breaker rather than a full efficiency bonus.
		value = remaining * (double_wind and 0.24 or 0.09)
	elseif kind <= 27 then
		local suit, rank = math.floor((kind - 1) / 9), ((kind - 1) % 9) + 1
		for _, indicator in ipairs(indicator_types(state, false)) do
			local dora = next_dora(indicator)
			if dora <= 27 and math.floor((dora - 1) / 9) == suit then
				local distance = math.abs(rank - ((dora - 1) % 9 + 1))
				if distance == 1 then
					value = value + 0.16
				elseif distance == 2 then
					value = value + 0.05
				end
			end
		end
	end
	return value
end

local function effective_tile_count(hand, melds, shanten, visible_counts, cache)
	local counts, total = type_counts(hand), 0
	local meld_count = #(melds or {})
	for kind = 1, 34 do
		if counts[kind] < 4 and (visible_counts[kind] or 0) < 4 then
			counts[kind] = counts[kind] + 1
			local improves = hand_shanten_counts(counts, meld_count, cache) < shanten
			counts[kind] = counts[kind] - 1
			if improves then
				total = total + math.max(0, 4 - (visible_counts[kind] or 0))
			end
		end
	end
	return total
end

local function dealer_aggression(state, seat)
	return seat == state.dealerIndex and 0.18 or 0
end

local function score_position_aggression(state, seat)
	local own, leader = state.scores[seat], state.scores[1]
	for index = 2, PLAYER_COUNT do
		leader = math.max(leader, state.scores[index])
	end
	if own + 12000 < leader then
		return 0.18
	end
	if own == leader then
		return -0.08
	end
	return 0
end

local function endgame_objective(state, seat)
	local final_wind = state.matchType == "hanchan" and 2 or 1
	local late = state.roundWind >= final_wind and state.handNumber >= 3
	if not late then
		return { mode = "normal", weight = 0 }
	end
	local own, rank = state.scores[seat], 1
	for other = 1, PLAYER_COUNT do
		if other ~= seat and state.scores[other] > own then
			rank = rank + 1
		end
	end
	local gap_up, gap_down = math.huge, math.huge
	for other = 1, PLAYER_COUNT do
		if other ~= seat then
			local delta = state.scores[other] - own
			if delta > 0 then
				gap_up = math.min(gap_up, delta)
			elseif delta < 0 then
				gap_down = math.min(gap_down, -delta)
			end
		end
	end
	if rank > 1 and gap_up <= 8000 then
		return { mode = "chase", weight = 0.26 }
	end
	if rank == 1 and gap_down <= 6000 then
		return { mode = "protect", weight = -0.24 }
	end
	return { mode = "normal", weight = 0 }
end

local function placement_push_value(state, seat, objective)
	local own, nearest_ahead, nearest_behind = state.scores[seat], math.huge, math.huge
	for other = 1, PLAYER_COUNT do
		if other ~= seat then
			local delta = state.scores[other] - own
			if delta > 0 then
				nearest_ahead = math.min(nearest_ahead, delta)
			elseif delta < 0 then
				nearest_behind = math.min(nearest_behind, -delta)
			end
		end
	end
	local sticks_and_honba = (state.riichiSticks or 0) * 1000 + (state.honba or 0) * 300
	if objective.mode == "chase" then
		-- A win that clears a nearby placement gap is worth materially more
		-- than its raw han estimate.  The bonus is capped because this remains
		-- a local heuristic rather than a full match-equity table.
		return 0.22 + math.max(0, 0.16 - math.min(nearest_ahead, 16000) / 100000)
	end
	if objective.mode == "protect" then
		-- When first with a close pursuer, a deal-in loses placement equity;
		-- riichi sticks and honba soften that only slightly.
		return -0.20 - math.max(0, 0.10 - math.min(nearest_behind, 10000) / 100000)
	end
	if sticks_and_honba >= 2000 then
		return 0.05
	end
	return 0
end

local function ai_push_mode(state, seat, minimum_shanten, best_value, pressure, aggression, objective, placement)
	if pressure < 0.72 then
		return "push"
	end
	if minimum_shanten >= 2 then
		-- A two-shanten hand usually folds to a real threat, but not when it has
		-- already secured roughly three han and enough draws remain to realize
		-- it.  Treat that as a mixed decision: safe tiles still win when danger
		-- is substantial, while near-safe choices may keep a valuable live shape.
		if pressure < 1.35 and best_value + placement >= 3 and #state.wall >= 32 then
			return "mixed"
		end
		return pressure >= 0.92 and "fold" or "mixed"
	end
	if minimum_shanten <= 0 then
		if
			pressure >= 1.55
			and best_value + placement < 1.6
			and #state.wall <= 18
			and objective.mode ~= "chase"
			and seat ~= state.dealerIndex
		then
			return "mixed"
		end
		return "push"
	end
	-- One-shanten against a real threat is normally neither an automatic push
	-- nor a full betaori: keep speed, but cash in a safe discard when it costs
	-- little.  Low value in a late, dangerous hand may still betaori.
	if
		pressure >= 1.25
		and best_value + placement < 2.15
		and #state.wall <= 24
		and aggression + 0.12 < pressure
		and objective.mode ~= "chase"
	then
		return "fold"
	end
	return "mixed"
end

local function future_safe_reserve(state, seat, hand, visible_counts, danger_cache)
	local kinds, reserve, fragile = {}, 0, 0
	for _, tile in ipairs(hand or {}) do
		local kind = tile_type(tile)
		if not kinds[kind] then
			kinds[kind] = true
			local danger = danger_cache[kind]
			if danger == nil then
				danger = tile_danger(state, seat, tile, visible_counts)
				danger_cache[kind] = danger
			end
			if danger <= 0.11 then
				reserve = reserve + 1
			elseif danger <= 0.26 then
				fragile = fragile + 1
			end
		end
	end
	-- The first two truly safe types are the important ones.  A third is
	-- useful but diminishing, while a merely low-risk tile is only half a
	-- reserve because a later threat can make it unusable.
	return math.min(2.5, reserve + math.min(2, fragile) * 0.35)
end

local function endgame_tenpai_value(state, candidate, objective)
	if candidate.shanten ~= 0 or #state.wall > 16 then
		return 0
	end
	-- This is deliberately only a fraction of the likely noten payment.  The
	-- number of other tenpai players is unknown, but retaining a legal
	-- structural tenpai in the last few draws is materially better than giving
	-- it up for a tiny shape gain.  It also applies to no-yaku formal tenpai.
	local urgency = math.max(0, 16 - #state.wall) / 16
	local value = 24 + urgency * 66
	if objective.mode == "protect" then
		value = value + 24
	elseif objective.mode == "chase" then
		value = value + 10
	end
	return value
end

local function choose_ai_discard(state, seat, hand, allowed, forbidden, melds)
	local player_id = state.players[seat]
	melds = melds or state.melds[player_id]
	local allow
	if allowed and #allowed > 0 then
		allow = {}
		for _, tile in ipairs(allowed) do
			allow[tile] = true
		end
	end
	local cache, shape_cache, candidates, candidate_keys, minimum_shanten = {}, {}, {}, {}, 8
	local base_counts = type_counts(hand)
	local meld_count = #(melds or {})
	for index, tile in ipairs(hand) do
		if (not allow or allow[tile]) and not (forbidden and forbidden[tile_type(tile)]) then
			local kind = tile_type(tile)
			local candidate_key = tostring(kind) .. (RED_FIVES[tile] and ":red" or ":plain")
			if candidate_keys[candidate_key] then
				goto continue_candidate
			end
			candidate_keys[candidate_key] = true
			local remaining = copy_array(hand)
			table.remove(remaining, index)
			base_counts[kind] = base_counts[kind] - 1
			local shanten = hand_shanten_counts(base_counts, meld_count, cache)
			base_counts[kind] = base_counts[kind] + 1
			minimum_shanten = math.min(minimum_shanten, shanten)
			candidates[#candidates + 1] = {
				tile = tile,
				hand = remaining,
				shanten = shanten,
				index = index,
			}
		end
		::continue_candidate::
	end
	if #candidates == 0 then
		return nil, nil
	end
	local visible = visible_type_counts(state, player_id, hand, melds)
	local pressure = ai_threat_pressure(state, seat)
	local objective = endgame_objective(state, seat)
	local placement = placement_push_value(state, seat, objective)
	local best_value = 0
	for _, candidate in ipairs(candidates) do
		candidate.value = estimated_hand_value(state, seat, candidate.hand, melds, candidate.shanten)
		local special = special_hand_profile(candidate.hand, melds)
		candidate.special = math.min(special.chiitoi, special.kokushi)
		candidate.specialRoute = special.chiitoi <= special.kokushi and "chiitoi" or "kokushi"
		best_value = math.max(best_value, candidate.value)
	end
	local aggression = (minimum_shanten <= 0 and 1.05 or minimum_shanten == 1 and 0.68 or 0.28)
		+ math.min(4, best_value) * 0.12
		+ dealer_aggression(state, seat)
		+ score_position_aggression(state, seat)
		+ objective.weight
		+ placement
	if #state.wall <= 20 then
		aggression = aggression - 0.18
	end
	local mode = ai_push_mode(state, seat, minimum_shanten, best_value, pressure, aggression, objective, placement)
	local opponent_riichi = false
	for other = 1, PLAYER_COUNT do
		if other ~= seat and state.riichi[state.players[other]] then
			opponent_riichi = true
			break
		end
	end
	local ukeire_candidates = {}
	for _, candidate in ipairs(candidates) do
		candidate.ukeire = 0
		-- Folding still compares ukeire in its score: when two discards are both
		-- acceptably safe, preserve the hand that can recover fastest.  Populate
		-- that existing term for the same bounded set of candidates instead of
		-- silently treating every folding candidate as zero ukeire.
		if candidate.shanten == minimum_shanten then
			candidate.preliminary = block_shape_value(candidate.hand, melds, shape_cache) * 1.7
				+ candidate.value * 18
					- tile_keep_bonus(state, seat, candidate.tile, base_counts, visible, candidate.shanten) * 13
				+ math.max(0, 3 - candidate.special) * (#state.wall >= 36 and 12 or 4)
			ukeire_candidates[#ukeire_candidates + 1] = candidate
		end
	end
	table.sort(ukeire_candidates, function(left, right)
		return left.preliminary > right.preliminary
	end)
	for index = 1, math.min(8, #ukeire_candidates) do
		local candidate = ukeire_candidates[index]
		candidate.ukeire = effective_tile_count(candidate.hand, melds, candidate.shanten, visible, cache)
		if candidate.shanten == 0 then
			candidate.wait = tenpai_wait_profile(state, seat, candidate.hand, melds, visible, tile_type(candidate.tile))
			candidate.waitQuality = candidate.wait.quality
		end
	end
	local best_ukeire = 0
	for _, candidate in ipairs(candidates) do
		if candidate.shanten == minimum_shanten then
			best_ukeire = math.max(best_ukeire, candidate.ukeire or 0)
		end
	end
	-- Do not reward the number of draws that improve a candidate relative to
	-- its own current shape.  That metric perversely favours a discard which
	-- first destroys a good block, because the damaged hand has more ways to
	-- recover.  Complete ukeire and the decomposition-aware current shape are
	-- comparable quantities; this raw recovery count is not.
	-- A genuinely broad, valuable tenpai can press through a modest threat;
	-- this happens after the light ukeire pass, without a draw/discard tree.
	if
		mode == "mixed"
		and minimum_shanten <= 0
		and best_ukeire >= 7
		and best_value >= 2.1
		and (pressure < 1.45 or objective.mode == "chase")
	then
		mode = "push"
	end
	local best, danger_cache = nil, {}
	for _, candidate in ipairs(candidates) do
		local kind = tile_type(candidate.tile)
		candidate.danger = danger_cache[kind]
		if candidate.danger == nil then
			candidate.danger = tile_danger(state, seat, candidate.tile, visible)
			danger_cache[kind] = candidate.danger
		end
		candidate.dealinRisk = tile_dealin_risk(state, seat, candidate.tile, visible)
		candidate.futureSafeReserve = future_safe_reserve(state, seat, candidate.hand, visible, danger_cache)
		candidate.endgameTenpai = endgame_tenpai_value(state, candidate, objective)
		candidate.shapeValue = block_shape_value(candidate.hand, melds, shape_cache)
		candidate.sequenceCore = sequence_core_value(candidate.hand)
		candidate.pairExtension = pair_extension_value(candidate.hand)
		local efficiency = -candidate.shanten * 300
			+ candidate.ukeire * 7
			+ (candidate.waitQuality or 0) * 6
			+ candidate.shapeValue * 1.7
			+ candidate.value * 18
			+ candidate.endgameTenpai
			+ math.max(0, 3 - candidate.special) * (#state.wall >= 36 and 10 or 2)
				- tile_keep_bonus(state, seat, candidate.tile, base_counts, visible, candidate.shanten) * 13
		if mode == "fold" then
			candidate.score = -candidate.dealinRisk * 1050
				- candidate.shanten * 28
				+ candidate.ukeire * 1.5
				+ candidate.futureSafeReserve * 28
					- tile_keep_bonus(state, seat, candidate.tile, base_counts, visible, candidate.shanten) * 2
		elseif mode == "mixed" then
			local viable = candidate.shanten == minimum_shanten
				and ((candidate.ukeire or 0) >= best_ukeire * 0.78 or best_ukeire == 0)
			candidate.score = efficiency * 0.62
				- candidate.dealinRisk * (220 + pressure * 220 - placement * 120)
				+ candidate.futureSafeReserve * 36
			if not viable then
				candidate.score = candidate.score - 420
			end
		else
			local defense_weight = 80 + math.max(0, pressure - aggression) * 260 - placement * 90
			candidate.score = efficiency - candidate.dealinRisk * defense_weight
		end
		local kind = tile_type(candidate.tile)
		local rank = kind <= 27 and (((kind - 1) % 9) + 1) or 0
		candidate.throw_order = kind >= 28 and 3 or (rank == 1 or rank == 9) and 2 or 1
		candidate.closeScoreKeep = tile_close_score_keep_value(state, seat, candidate.tile, base_counts, visible)
		if
			not best
			or candidate.score > best.score + 0.001
			or (
				-- When all scored quantities are exactly tied, preserve a real
				-- pair-plus-neighbour extension before retaining a singleton
				-- yakuhai merely as a close-score option.  The former already has
				-- a head; the latter still needs a second copy to become a route.
				pressure <= 0.35
				and candidate.shanten == best.shanten
				and math.abs(candidate.score - best.score) <= 0.001
				and candidate.pairExtension > (best.pairExtension or 0)
			)
			or (
				math.abs(candidate.score - best.score) <= 4
				and candidate.closeScoreKeep < best.closeScoreKeep - 0.001
			)
		or (
			-- At low pressure, one extra live copy is not enough to justify
			-- breaking a strictly richer consecutive core when all first-order
			-- quantities agree.  This is a shape dominance tie-break, not a
			-- weighted adjacency bonus.
			pressure <= 0.35
			and candidate.shanten == best.shanten
			and math.abs((candidate.ukeire or 0) - (best.ukeire or 0)) <= 1
			and math.abs((candidate.shapeValue or 0) - (best.shapeValue or 0)) <= 0.001
			and math.abs((candidate.value or 0) - (best.value or 0)) <= 0.001
			and candidate.sequenceCore > (best.sequenceCore or 0)
		)
			or (
				-- A narrow repeated inversion found in the Mortal audit: when
				-- pressure is low and the two hands are otherwise comparable, a
				-- slightly smaller ukeire can be correct if it preserves a
				-- materially richer block decomposition.  Keep this bounded to
				-- at most one live tile of ukeire and near-equal value.  Require
				-- enough absolute acceptance for the hand's shanten distance; in
				-- deep closed hands, raw speed remains more important than shape.
				pressure <= 0.35
				and candidate.shanten == best.shanten
				and (candidate.shapeValue or 0) >= (best.shapeValue or 0) + 2
				and (best.ukeire or 0) - (candidate.ukeire or 0) <= 1
				and (state.callOccurred or #state.wall <= 45)
				and (
					(candidate.shanten == 1 and (candidate.ukeire or 0) >= 10)
					or (candidate.shanten == 2 and (candidate.ukeire or 0) >= 20)
					or (candidate.shanten >= 3 and (candidate.ukeire or 0) >= 18)
				)
				and math.abs((candidate.value or 0) - (best.value or 0)) <= 0.001
				and candidate.score >= best.score - 14
			)
			or (
				-- After a call has occurred and no opponent is in riichi, the other
				-- repeated Mortal inversion is a small shape-over-speed trade: when
				-- speed is otherwise close, preserving a stronger block structure
				-- avoids throwing away the hand's next route for one live tile.
				state.callOccurred
				and not state.riichi[player_id]
				and not opponent_riichi
				and pressure >= 0.25
				and pressure <= 0.65
				and candidate.shanten == best.shanten
				and (candidate.shapeValue or 0) >= (best.shapeValue or 0) + 2
				and (best.ukeire or 0) - (candidate.ukeire or 0) == 1
				and (
					(candidate.shanten == 1 and (candidate.ukeire or 0) >= 10)
					or (candidate.shanten == 2 and (candidate.ukeire or 0) >= 10)
				)
				and math.abs((candidate.value or 0) - (best.value or 0)) <= 0.001
				and candidate.score >= best.score - 24
			)
			or (
				math.abs(candidate.score - best.score) <= 0.001
				and math.abs(candidate.closeScoreKeep - best.closeScoreKeep) <= 0.001
				and candidate.throw_order > best.throw_order
			)
		then
			best = candidate
		end
	end
	best.folding, best.mode, best.pressure, best.aggression = mode == "fold", mode, pressure, aggression
	best.objective = objective.mode
	return best.tile, best
end

function setup(context)
	local players, names, ai_players = setup_players(context)
	if #players ~= PLAYER_COUNT then
		error("Mahjong requires exactly four players")
	end
	local settings = context.match and context.match.settings or {}
	return new_match(players, names, normalize_random_seed(context.match.randomSeed), settings, ai_players)
end

function export_paipu(state, mode)
	local source = state.paipu
	if type(source) ~= "table" then
		return nil
	end
	local players = {}
	for seat, player_id in ipairs(state.players) do
		players[#players + 1] = {
			seat = seat,
			id = player_id,
			name = state.playerNames[seat],
			kind = state.aiPlayers and state.aiPlayers[player_id] and "ai" or "human",
		}
	end
	local ranks = {}
	for seat, score in ipairs(state.scores) do
		local rank = 1
		for other_seat, other in ipairs(state.scores) do
			if other > score or (other == score and other_seat < seat) then
				rank = rank + 1
			end
		end
		ranks[seat] = rank
	end
	return {
		format = source.format,
		formatVersion = source.formatVersion,
		game = {
			mode = mode or "solo",
			matchType = state.matchType,
			rules = copy_record_value(state.rules),
			initialScores = copy_record_value(source.initialScores),
		},
		players = players,
		hands = copy_record_value(source.hands),
		status = state.matchEnded and "completed" or "in_progress",
		final = state.matchEnded and {
			endReasonId = PAIPU.reason_id(state.endReason),
			scores = copy_scores_for_record(state.scores),
			ranks = ranks,
		} or nil,
		integrity = {
			eventCount = source.eventCount,
		},
	}
end

function view(state, events, context)
	local viewer_id, own_hand = context.viewer.id, {}
	for _, tile in ipairs(state.hands[viewer_id] or {}) do
		own_hand[#own_hand + 1] = tile
	end
	local hand_counts, revealed, revealed_drawn = {}, {}, {}
	local reveal_all_hands = context.viewer and context.viewer.revealAllHands == true
	for _, player_id in ipairs(state.players) do
		hand_counts[player_id] = #(state.hands[player_id] or {})
		if state.phase == "hand_ended" or reveal_all_hands then
			revealed[player_id] = {}
			for _, tile in ipairs(state.hands[player_id]) do
				revealed[player_id][#revealed[player_id] + 1] = {
					type = tile_type(tile),
					red = RED_FIVES[tile] == true,
				}
			end
			if reveal_all_hands and state.turnIndex and state.players[state.turnIndex] == player_id and state.drawnTile > 0 then
				revealed_drawn[player_id] = {
					type = tile_type(state.drawnTile),
					red = RED_FIVES[state.drawnTile] == true,
				}
			end
		end
	end
	local response_index = 0
	-- Every unresolved player receives their own private response window. Other
	-- viewers still cannot infer who can chi, pon, kan, or ron before resolution.
	local _, claimant = pending_claimant_for_player(state, viewer_id)
	if state.phase == "claiming" and claimant then
		response_index = claimant.playerIndex
	end
	local indicators = {}
	for _, kind in ipairs(indicator_types(state, false)) do
		indicators[#indicators + 1] = kind
	end
	local visible_indicator_tiles = indicator_tiles(state, false)
	local ura_indicator_tiles = state.phase == "hand_ended"
		and indicator_tiles(state, true)
		or {}
	return {
		state = {
			players = state.players,
			playerNames = state.playerNames,
			aiPlayers = state.aiPlayers,
			matchType = state.matchType,
			roundWind = state.roundWind,
			handNumber = state.handNumber,
			dealerIndex = state.dealerIndex,
			initialDealerIndex = state.initialDealerIndex,
			honba = state.honba,
			riichiSticks = state.riichiSticks,
			scores = state.scores,
			scoreHistory = state.scoreHistory,
			turnIndex = state.turnIndex,
			responseIndex = response_index,
			phase = state.phase,
			pendingDiscard = state.phase == "claiming" and state.lastDiscard and {
				playerIndex = state.lastDiscard.playerIndex,
				discardIndex = state.lastDiscard.discardIndex,
				tile = tile_type(state.lastDiscard.tile),
				red = RED_FIVES[state.lastDiscard.tile] == true,
			} or nil,
			drawnPlayerIndex = state.drawnTile > 0 and state.turnIndex or 0,
			wallCount = #state.wall,
			doraIndicators = indicators,
			doraIndicatorTiles = visible_indicator_tiles,
			uraDoraIndicatorTiles = ura_indicator_tiles,
			ownHand = own_hand,
			handCounts = hand_counts,
			discards = visible_discards(state),
			melds = visible_melds(state),
			legalActions = legal_actions(state, viewer_id, context.fastLegalActions == true),
			drawnTile = state.turnIndex == player_index(state, viewer_id) and state.drawnTile or 0,
			riichi = state.riichi,
			furiten = context.fastLegalActions ~= true and is_furiten(state, viewer_id) or false,
			winner = state.winner,
			winnerIndex = state.winnerIndex,
			winType = state.winType,
			winningTile = state.winningTile > 0 and tile_type(state.winningTile) or 0,
			winningTileRed = RED_FIVES[state.winningTile] == true,
			draw = state.draw,
			moveCount = state.moveCount,
			result = state.result,
			results = state.results,
			winners = state.winners,
			abortiveReason = state.abortiveReason,
			abortivePlayerIndex = tonumber(state.abortivePlayerIndex) or 0,
			abortiveTile = (tonumber(state.abortiveTile) or 0) > 0 and tile_type(state.abortiveTile) or 0,
			abortiveTileRed = RED_FIVES[state.abortiveTile] == true,
			matchEnded = state.matchEnded,
			endReason = state.endReason,
			rules = state.rules,
			revealedHands = revealed,
			revealedDrawnTiles = revealed_drawn,
			revealAllHands = reveal_all_hands,
		},
		events = visible_events(events, viewer_id),
	}
end

function on_action(state, action, context)
	if type(action) ~= "table" then
		return rejected("invalid_action")
	end
	local actor_id, seat = context.actor.id, player_index(state, context.actor.id)
	if not seat then
		return rejected("not_a_player")
	end
	if action.type == "next_hand" then
		if state.phase ~= "hand_ended" or state.matchEnded then
			return rejected("next_hand_not_available")
		end
		state.dealerIndex, state.handNumber = state.nextDealerIndex, state.nextHandNumber
		state.roundWind, state.honba = state.nextRoundWind, state.nextHonba
		deal(state)
		return accepted(state, { { type = "next_hand", player = actor_id, playerIndex = seat } })
	end
	if action.type == "new_match" then
		if state.phase ~= "hand_ended" then
			return rejected("game_not_over")
		end
		local next_seed = next_match_seed(state.seed)
		local players, names = copy_array(state.players), copy_array(state.playerNames)
		local next_settings = {
			matchType = state.matchType,
			rules = state.rules,
			canonicalMatchSeats = state.canonicalMatchSeats == true,
		}
		if state.canonicalMatchSeats then
			local seat_draw = (next_seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
			local east = (seat_draw % PLAYER_COUNT) + 1
			players, names = {}, {}
			for offset = 0, PLAYER_COUNT - 1 do
				local source = ((east - 1 + offset) % PLAYER_COUNT) + 1
				players[#players + 1] = state.players[source]
				names[#names + 1] = state.playerNames[source]
			end
			next_settings.initialDealerSeat = 1
		end
		local next_state = new_match(players, names, next_seed, next_settings, state.aiPlayers)
		return accepted(
			next_state,
			{ { type = "new_match", player = actor_id, playerIndex = player_index(next_state, actor_id) } }
		)
	end
	if state.phase == "hand_ended" then
		return rejected("game_over")
	end
	if state.phase == "claiming" then
		return apply_claim_response(state, action, actor_id)
	end
	if action.type == "tsumo" then
		return apply_tsumo(state, actor_id, seat)
	end
	if action.type == "abort_nine" then
		return apply_abort_nine(state, actor_id, seat)
	end
	if action.type == "kan" then
		return apply_self_kan(state, action, actor_id, seat)
	end
	if action.type == "riichi" and type(action.tileId) == "number" then
		return apply_riichi(state, action, actor_id, seat)
	end
	return apply_discard(state, action, actor_id, seat)
end

local function copy_meld_list(melds)
	local result = {}
	for _, meld in ipairs(melds or {}) do
		result[#result + 1] = meld
	end
	return result
end

local function simulated_claim(state, claimant, option)
	local hand = copy_array(state.hands[claimant.playerId])
	for _, tile in ipairs(option.tileIds or {}) do
		remove_tile(hand, tile)
	end
	local meld_tiles = { state.lastDiscard.tile }
	for _, tile in ipairs(option.tileIds or {}) do
		meld_tiles[#meld_tiles + 1] = tile
	end
	local melds = copy_meld_list(state.melds[claimant.playerId])
	melds[#melds + 1] = {
		kind = option.kind,
		tiles = meld_tiles,
		fromIndex = state.lastDiscard.playerIndex,
		calledTile = state.lastDiscard.tile,
	}
	if option.kind == "kan" then
		return hand,
			melds,
			{
				shanten = hand_shanten(hand, melds, {}),
				ukeire = 0,
				value = estimated_hand_value(state, claimant.playerIndex, hand, melds),
				danger = 0,
			}
	end
	local _, discard = choose_ai_discard(state, claimant.playerIndex, hand, nil, kuikae_forbidden_types(option), melds)
	return hand, melds, discard
end

local function choose_ai_claim(state, claimant)
	for index, option in ipairs(claimant.options) do
		if option.kind == "ron" then
			return { type = "claim", option = index }
		end
	end
	local seat, player_id = claimant.playerIndex, claimant.playerId
	local current_hand, current_melds = state.hands[player_id], state.melds[player_id]
	local current_shanten = hand_shanten(current_hand, current_melds, {})
	local current_goal = ai_hand_goal(state, seat, current_hand, current_melds)
	local pressure = ai_threat_pressure(state, seat)
	local best
	for index, option in ipairs(claimant.options) do
		if option.kind ~= "ron" then
			local hand, melds, discard = simulated_claim(state, claimant, option)
			if discard then
				local improvement = current_shanten - discard.shanten
				local goal = ai_hand_goal(state, seat, discard.hand or hand, melds)
				-- A call only treats guaranteed yaku (or the value tile just called)
				-- as sufficient to win.  Distant toitoi and flush potential can add
				-- score, but cannot authorize a call by themselves.
				local has_yaku = goal.guaranteedOpen >= 1
				local value = discard.value or estimated_hand_value(state, seat, hand, melds)
				local called_kind = tile_type(state.lastDiscard.tile)
				local yakuhai_call = option.kind ~= "chi" and value_honor_kind(state, seat, called_kind)
				local dealer_bonus = dealer_aggression(state, seat) * 70
				local score = improvement * 150
					- discard.shanten * 32
					+ (discard.ukeire or 0) * 3
					+ value * 18
					+ goal.openValue * 24
					+ dealer_bonus
				if yakuhai_call then
					score = score + 54
				end
				if option.kind == "kan" then
					score = score + 10
				end
				if option.kind == "chi" then
					score = score - 8
				end
				if goal.route == current_goal.route then
					score = score + 12
				end
				if current_goal.preserveClosed then
					score = score - 44
				end
				if pressure >= 0.9 then
					score = score - pressure * 90
				end
				-- Potential routes never authorize a distant or slow call, but a
				-- clear one-step speed gain into tenpai may take an all-simple route
				-- when its post-call hand has no outside tiles.  This admits the
				-- ordinary chi-to-tenpai case without treating every early tanyao
				-- shape (or any honitsu/toitoi wish) as a made yaku.
				local locked_tanyao = goal.route == "tanyao" and discard.shanten <= 0 and goal.openValue >= 1
				local acceptable = (has_yaku or locked_tanyao)
					and discard.shanten <= 2
					and (
						improvement >= 1
						or (
							improvement == 0
							and discard.shanten <= 1
							and value >= 2.2
							and pressure < 0.9 + dealer_aggression(state, seat)
						)
					)
				if yakuhai_call and discard.shanten <= 2 and improvement >= 0 then
					acceptable = true
				end
				if current_goal.preserveClosed and improvement < 1 then
					acceptable = false
				end
				-- A zero-shanten-gain chi is especially costly: unlike a value pon,
				-- it usually opens a sequence without creating a guaranteed yaku and
				-- gives up both the closed-hand route and defensive flexibility.  The
				-- non-test Mortal audit found this inversion one-way (15 current zero
				-- gain chis: 14 Mortal passes, no Mortal chis), while zero-gain pons
				-- and kans remained bidirectional and are intentionally left alone.
				if option.kind == "chi" and improvement <= 0 then
					acceptable = false
				end
				-- A zero-gain pon needs a concrete reason to spend the closed-hand
				-- route.  Keep the narrow exception Mortal repeatedly accepts: a
				-- value-honor pon that commits to an already identified toitoi route,
				-- even while still distant (2+ shanten).  Other zero-gain pons either
				-- add a nominal yaku without improving the route, or open a hand with
				-- no reliable score increase; those should pass for now.
				local distant_yakuhai_toitoi =
					yakuhai_call and goal.route == "toitoi" and discard.shanten >= 2
				if option.kind == "pon" and improvement <= 0 and not distant_yakuhai_toitoi then
					acceptable = false
				end
				-- Daiminkan is a separate commitment from pon: it adds dora volatility,
				-- can improve every opponent's hand, and removes the option to keep the
				-- fourth copy as a later decision.  In the fresh claim audit, 15 of 16
				-- AI daiminkans were Mortal passes; the only counterexample is not a
				-- basis for an exception.  Self-kans are evaluated independently.
				if option.kind == "kan" then
					acceptable = false
				end
				if option.kind == "kan" and pressure >= 0.75 and not state.riichi[player_id] then
					acceptable = false
				end
				if acceptable and (not best or score > best.score) then
					best = { index = index, score = score }
				end
			end
		end
	end
	return best and { type = "claim", option = best.index } or { type = "pass" }
end

local function riichi_wait_profile(state, seat, candidate)
	local player_id = state.players[seat]
	local visible = visible_type_counts(state, player_id, hand_with_drawn(state, player_id), state.melds[player_id])
	return tenpai_wait_profile(state, seat, candidate.hand, state.melds[player_id], visible, tile_type(candidate.tile))
end

local function should_declare_riichi(state, seat, candidate)
	local player_id = state.players[seat]
	local value, natural = estimated_hand_value(state, seat, candidate.hand, state.melds[player_id])
	local wait = riichi_wait_profile(state, seat, candidate)
	local waits, quality = wait.count, wait.quality
	local pressure = ai_threat_pressure(state, seat)
	local objective = endgame_objective(state, seat)
	local placement = placement_push_value(state, seat, objective)
	if waits == 0 then
		return false
	end
	local leader = state.scores[1]
	for index = 2, PLAYER_COUNT do
		leader = math.max(leader, state.scores[index])
	end
	if state.scores[seat] + 8000 < leader or objective.mode == "chase" then
		return true
	end
	if objective.mode == "protect" and quality < 4.2 and seat ~= state.dealerIndex then
		return false
	end
	if pressure >= 1 and candidate.danger > 0.22 and seat ~= state.dealerIndex and placement <= 0.08 then
		return false
	end
	if #state.wall <= 12 and (waits <= 2 or quality < 3) then
		return false
	end
	-- A non-dealer's one-han bad-shape dama retains defense and improvement
	-- room.  When behind, in the final hand, or with a shallow wall, riichi can
	-- still be right for tsumo, ura-dora, and ippatsu upside.
	if
		seat ~= state.dealerIndex
		and natural == 1
		and (waits <= 3 or quality < 3.4)
		and #state.wall >= 18
		and state.scores[seat] + 8000 >= leader
	then
		return false
	end
	if value >= 4 and quality >= 2 and placement <= 0.08 then
		return false
	end
	if natural < 1 and #state.wall <= 10 and quality < 3.2 and seat ~= state.dealerIndex then
		return false
	end
	if seat == state.dealerIndex then
		return quality >= 1.8 or value < 4.5
	end
	return quality >= 3.4 or (value < 3 and waits >= 4)
end

local function choose_ai_self_kan(state, seat, options)
	if #options == 0 then
		return nil
	end
	local player_id = state.players[seat]
	if state.riichi[player_id] then
		for _, option in ipairs(options) do
			if option.kind == "ankan" then
				return option
			end
		end
		return nil
	end
	local pressure = ai_threat_pressure(state, seat)
	if pressure >= 0.75 then
		return nil
	end
	local hand = hand_with_drawn(state, player_id)
	local _, profile =
		choose_ai_discard(state, seat, hand, nil, state.kuikaeForbidden and state.kuikaeForbidden[player_id])
	local value = estimated_hand_value(state, seat, hand, state.melds[player_id])
	if profile and profile.shanten <= 1 and (value >= 1.5 or seat == state.dealerIndex or #state.wall >= 36) then
		return options[1]
	end
	return nil
end

local function should_abort_nine_tiles(state, player_id)
	local distinct = {}
	for _, tile in ipairs(hand_with_drawn(state, player_id)) do
		local kind = tile_type(tile)
		if is_outside(kind) then
			distinct[kind] = true
		end
	end
	local count = 0
	for _ in pairs(distinct) do
		count = count + 1
	end
	return count < 11
end

function ai_action(state, actor_id)
	local seat = player_index(state, actor_id)
	if not seat or state.phase == "hand_ended" then
		return nil
	end
	if state.phase == "claiming" then
		local _, claimant = pending_claimant_for_player(state, actor_id)
		if not claimant then
			return nil
		end
		return choose_ai_claim(state, claimant)
	end
	if state.phase ~= "playing" or state.turnIndex ~= seat then
		return nil
	end
	if state.drawnTile > 0 and score_hand(state, seat, state.drawnTile, "tsumo") then
		return { type = "tsumo" }
	end
	if can_abort_nine(state, actor_id) and should_abort_nine_tiles(state, actor_id) then
		return { type = "abort_nine" }
	end
	local concealed = hand_with_drawn(state, actor_id)
	local kans = self_kan_options(state, actor_id)
	local kan = choose_ai_self_kan(state, seat, kans)
	if kan then
		return { type = "kan", kind = kan.kind, tileType = kan.tileType }
	end
	if state.riichi[actor_id] then
		return { type = "discard", tileId = state.drawnTile }
	end
	local forbidden = state.kuikaeForbidden and state.kuikaeForbidden[actor_id]
	local riichi_tiles = riichi_discards(state, actor_id)
	if #riichi_tiles > 0 then
		local tile, candidate = choose_ai_discard(state, seat, concealed, riichi_tiles, forbidden)
		if tile and candidate and should_declare_riichi(state, seat, candidate) then
			return { type = "riichi", tileId = tile }
		end
	end
	local tile = choose_ai_discard(state, seat, concealed, nil, forbidden)
	return { type = "discard", tileId = tile or state.drawnTile or concealed[1] }
end

function on_player_left(state, context)
	return { state = state, events = { { type = "player_left", player = context.actor.id } } }
end

function on_return_to_room(state, context)
	return true
end
