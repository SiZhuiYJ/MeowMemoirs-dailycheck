

export default function useData() {
  const data = ref<{ id: Number; name: string }>();
  return { data };
}
