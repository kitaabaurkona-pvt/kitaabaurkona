import { useParams } from 'react-router-dom';

function ProductDetail() {
  const { id } = useParams();

  return (
    <>
      <h1>Product Detail</h1>
      <main></main>
    </>
  );
}

export default ProductDetail;
