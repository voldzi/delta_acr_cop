# Run only inside the exact-base, network-none release build container.
# Add the already compiled read-only identity module to the release boot tables.
old_module = CsmMessaging.MatrixIdentityStore
new_module = CsmMessaging.MatrixIdentityLookup
walk = fn walk, term, add? ->
  cond do
    is_tuple(term) ->
      {values, count} = walk.(walk, Tuple.to_list(term), add?)
      {List.to_tuple(values), count}
    is_list(term) ->
      {items, nested} = Enum.map_reduce(term, 0, fn item, total ->
        {value, n} = walk.(walk, item, add?)
        {value, total + n}
      end)
      if Enum.member?(items, old_module) do
        if add? do
          false = Enum.member?(items, new_module)
          {Enum.flat_map(items, fn x -> if x == old_module, do: [x, new_module], else: [x] end), nested + 1}
        else
          true = Enum.member?(items, new_module)
          {List.delete(items, new_module), nested + 1}
        end
      else
        {items, nested}
      end
    true -> {term, 0}
  end
end
out = "/overlay/app/releases/0.1.0"
File.mkdir_p!(out)
for name <- ["start", "start_clean"] do
  path = "/app/releases/0.1.0/" <> name
  original = :erlang.binary_to_term(File.read!(path <> ".boot"))
  {:ok, [^original]} = :file.consult(String.to_charlist(path <> ".script"))
  {updated, 2} = walk.(walk, original, true)
  {^original, 2} = walk.(walk, updated, false)
  File.write!(out <> "/" <> name <> ".boot", :erlang.term_to_binary(updated))
  File.write!(out <> "/" <> name <> ".script", :io_lib.format(~c"~tp.~n", [updated]))
  IO.puts(Jason.encode!(%{artifact: name, additions: 2, originalRecoveredByRemovingOnlyNewModule: true}))
end
