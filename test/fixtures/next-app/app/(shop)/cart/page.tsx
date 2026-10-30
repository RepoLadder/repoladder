import { addToCart } from "../../../lib";

export default function Cart() {
  return <form action={addToCart} />;
}
