import { Form } from "../../components/Form";

export default function Dashboard() {
  async function archive(id: string) {
    "use server";
    console.log(id);
  }
  return <Form onArchive={archive} />;
}
