// Sample code with deliberate problems, to show what the UI check reports.
export function Projects() {
  const { data } = useQuery({ queryKey: ["projects"], queryFn: getProjects });
  return (
    <section>
      <img src="/team.png" />
      <a href="#">View all</a>
      <input placeholder="Search projects" />
      <ul className="text-[#2b6cf0]">
        {data.map(p => <li key={p.id}>{p.name}</li>)}
      </ul>
      <button onClick={() => {}}>Submit</button>
    </section>
  );
}
